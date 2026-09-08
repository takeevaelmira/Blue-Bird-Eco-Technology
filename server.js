const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Health-check endpoint для предотвращения засыпания на Render
    if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }

    if (req.url === '/api/search-cars' && req.method === 'POST') {
        let body = '';

        req.on('data', chunk => {
            body += chunk;
        });

        req.on('end', () => {
            const clientData = body ? JSON.parse(body) : {};

            const requestedYearMin = clientData.filters && clientData.filters.yearMin ? clientData.filters.yearMin : 2022;
            const requestedYearMax = clientData.filters && clientData.filters.yearMax ? clientData.filters.yearMax : null;
            const requestedBrand = clientData.filters && clientData.filters.brand ? clientData.filters.brand.toLowerCase() : null;
            const requestedMileageMax = clientData.filters && clientData.filters.mileageMax ? clientData.filters.mileageMax : null;
            const requestedBaseFuel = clientData.filters && clientData.filters.baseFuel ? clientData.filters.baseFuel.toLowerCase() : null;

            const requestPayload = {
                providerId: clientData.providerId || 2,
                offset: clientData.offset || 0,
                limit: 100,
                filters: {
                    saleOnly: true,
                    yearMin: requestedYearMin,
                    ...(requestedYearMax ? { yearMax: requestedYearMax } : {}),
                    ...(clientData.filters || {})
                }
            };

            if (clientData.query && clientData.query.trim() !== '') {
                requestPayload.query = clientData.query.trim();
            }

            const requestData = JSON.stringify(requestPayload);

            const options = {
                hostname: 'api.motor-feed.com',
                path: '/search',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestData),
                    'x-api-key': API_KEY ? API_KEY.trim() : ''
                }
            };

            const proxyReq = https.request(options, proxyRes => {
                let responseData = '';

                proxyRes.on('data', chunk => {
                    responseData += chunk;
                });

                proxyRes.on('end', () => {
                    try {
                        const parsed = JSON.parse(responseData);
                        let items = parsed.items || parsed.listings || parsed.result || (Array.isArray(parsed) ? parsed : []);
                        
                        // 1. Гибкая фильтрация по типу топлива (baseFuel / fuelName)
                        if (requestedBaseFuel) {
                            items = items.filter(car => {
                                const baseFuel = (car.pricing && car.pricing.baseFuel) ? car.pricing.baseFuel.toLowerCase() : '';
                                const fuelName = (
                                    (car.spec && car.spec.fuelName) || 
                                    (car.specs && car.specs.fuelName) || 
                                    ''
                                ).toLowerCase();

                                if (requestedBaseFuel === 'hybrid') {
                                    return baseFuel.includes('hybrid') || 
                                           fuelName.includes('hybrid') || 
                                           fuelName.includes('hev') || 
                                           fuelName.includes('phev') || 
                                           fuelName.includes('гибрид');
                                } else if (requestedBaseFuel === 'petrol') {
                                    return baseFuel.includes('petrol') || baseFuel.includes('gasoline') || fuelName.includes('petrol');
                                }
                                return true;
                            });
                        }

                        // 2. Фильтрация по году
                        items = items.filter(car => {
                            const titleStr = (car.title || '').toLowerCase();
                            const genStr = car.vehicleIdentity && car.vehicleIdentity.generation ? String(car.vehicleIdentity.generation) : '';

                            let year = requestedYearMin;
                            const matchYear = (titleStr + ' ' + genStr).match(/20\d{2}/);
                            if (matchYear) {
                                year = parseInt(matchYear[0], 10);
                            } else if (car.year) {
                                year = parseInt(car.year, 10);
                            } else if (car.yearMonth) {
                                year = parseInt(String(car.yearMonth).substring(0, 4), 10);
                            }

                            if (requestedYearMax) {
                                return year === requestedYearMax;
                            }
                            return year >= requestedYearMin;
                        });

                        // 3. Фильтрация по бренду
                        if (requestedBrand) {
                            items = items.filter(car => {
                                const brandStr = car.vehicleIdentity && car.vehicleIdentity.brand ? car.vehicleIdentity.brand.toLowerCase() : '';
                                const titleStr = (car.title || '').toLowerCase();
                                return brandStr.includes(requestedBrand) || titleStr.includes(requestedBrand);
                            });
                        }

                        // 4. Фильтрация по пробегу
                        if (requestedMileageMax) {
                            items = items.filter(car => {
                                let mileage = null;
                                if (typeof car.mileage === 'number') {
                                    mileage = car.mileage;
                                } else if (car.specs && typeof car.specs.mileage === 'number') {
                                    mileage = car.specs.mileage;
                                } else if (car.spec && typeof car.spec.mileage === 'number') {
                                    mileage = car.spec.mileage;
                                } else {
                                    const textToCheck = (car.title || '') + ' ' + (car.description || '');
                                    const match = textToCheck.match(/(\d[\d,\s]*)\s*(км|km)/i);
                                    if (match) {
                                        mileage = parseInt(match[1].replace(/[\s,]/g, ''), 10);
                                    }
                                }
                                
                                if (mileage === null) return true;
                                return mileage <= requestedMileageMax;
                            });
                        }

                        // 5. Фильтрация по поисковому запросу
                        if (clientData.query && clientData.query.trim() !== '') {
                            const q = clientData.query.trim().toLowerCase();
                            items = items.filter(car => {
                                const titleStr = (car.title || '').toLowerCase();
                                const brand = car.vehicleIdentity && car.vehicleIdentity.brand ? car.vehicleIdentity.brand.toLowerCase() : '';
                                const model = car.vehicleIdentity && car.vehicleIdentity.model ? car.vehicleIdentity.model.toLowerCase() : '';
                                return titleStr.includes(q) || brand.includes(q) || model.includes(q);
                            });
                        }

                        const clientLimit = clientData.limit || 20;
                        const clientOffset = clientData.offset || 0;
                        const paginatedItems = items.slice(clientOffset, clientOffset + clientLimit);

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ items: paginatedItems }));
                        return;

                    } catch (e) {
                        console.error('Error processing API response:', e);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Internal Server Error' }));
                    }
                });
            });

            proxyReq.on('error', err => {
                console.error('Proxy error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Proxy error' }));
            });

            proxyReq.write(requestData);
            proxyReq.end();
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
