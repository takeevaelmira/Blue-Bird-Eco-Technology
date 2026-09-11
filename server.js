const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const reviewsStore = {}; 

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }

    // --- Эндпоинт для передачи публичного CLIENT_ID на клиент ---
    if (req.url === '/api/config' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ clientId: CLIENT_ID || '' }));
        return;
    }

    // --- Эндпоинт обмена Google OAuth кода ---
    if (req.url === '/api/auth/google' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { code, redirectUri } = JSON.parse(body);

                if (!CLIENT_ID || !CLIENT_SECRET) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'CLIENT_ID or CLIENT_SECRET not configured on server' }));
                    return;
                }

                const postData = new URLSearchParams({
                    code: code,
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code'
                }).toString();

                const tokenOptions = {
                    hostname: 'oauth2.googleapis.com',
                    path: '/token',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                };

                const tokenReq = https.request(tokenOptions, tokenRes => {
                    let tokenData = '';
                    tokenRes.on('data', chunk => { tokenData += chunk; });
                    tokenRes.on('end', () => {
                        try {
                            const tokenParsed = JSON.parse(tokenData);
                            const accessToken = tokenParsed.access_token;

                            if (!accessToken) {
                                res.writeHead(400, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ error: 'Failed to obtain access token from Google', details: tokenParsed }));
                                return;
                            }

                            const userOptions = {
                                hostname: 'www.googleapis.com',
                                path: '/oauth2/v3/userinfo',
                                method: 'GET',
                                headers: {
                                    'Authorization': `Bearer ${accessToken}`
                                }
                            };

                            const userReq = https.request(userOptions, userRes => {
                                let userData = '';
                                userRes.on('data', chunk => { userData += chunk; });
                                userRes.on('end', () => {
                                    res.writeHead(200, { 'Content-Type': 'application/json' });
                                    res.end(userData);
                                });
                            });

                            userReq.on('error', () => {
                                res.writeHead(500, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ error: 'Failed to fetch Google user profile' }));
                            });

                            userReq.end();

                        } catch (e) {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Error parsing Google token response' }));
                        }
                    });
                });

                tokenReq.on('error', () => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Google OAuth network error' }));
                });

                tokenReq.write(postData);
                tokenReq.end();

            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid request body' }));
            }
        });
        return;
    }

    // --- Эндпоинты отзывов ---
    if (req.url.startsWith('/api/reviews') && req.method === 'GET') {
        const urlParams = new URL(req.url, `http://${req.headers.host}`);
        const carId = urlParams.searchParams.get('carId');
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reviewsStore[carId] || []));
        return;
    }

    if (req.url === '/api/reviews' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { carId, rating, comment, user } = JSON.parse(body);
                if (!carId || !rating || !user || !user.name) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Unauthorized or missing required fields' }));
                    return;
                }

                if (!reviewsStore[carId]) {
                    reviewsStore[carId] = [];
                }

                const newReview = {
                    id: Date.now(),
                    username: user.name,
                    userAvatar: user.picture || '',
                    rating: Number(rating),
                    comment: comment || '',
                    date: new Date().toLocaleDateString()
                };

                reviewsStore[carId].push(newReview);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, review: newReview }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    // --- Прокси-эндпоинт поиска машин ---
    if (req.url === '/api/search-cars' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
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
                limit: 1000000,
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
                proxyRes.on('data', chunk => { responseData += chunk; });
                proxyRes.on('end', () => {
                    try {
                        const parsed = JSON.parse(responseData);
                        let items = parsed.items || parsed.listings || parsed.result || (Array.isArray(parsed) ? parsed : []);
                        
                        if (requestedBaseFuel) {
                            items = items.filter(car => {
                                const fuelName = ((car.pricing && car.pricing.baseFuel) || (car.spec && car.spec.fuelName) || (car.specs && car.specs.fuelName) || '').toLowerCase();
                                const titleStr = (car.title || '').toLowerCase();
                                return fuelName.includes('hybrid') || fuelName.includes('hev') || fuelName.includes('phev') || fuelName.includes('гибрид') || titleStr.includes('hybrid') || titleStr.includes('гибрид');
                            });
                        }

                        items = items.filter(car => {
                            const titleStr = (car.title || '').toLowerCase();
                            const genStr = car.vehicleIdentity && car.vehicleIdentity.generation ? String(car.vehicleIdentity.generation) : '';
                            let year = requestedYearMin;
                            const matchYear = (titleStr + ' ' + genStr).match(/20\d{2}/);
                            if (matchYear) year = parseInt(matchYear[0], 10);
                            else if (car.year) year = parseInt(car.year, 10);
                            
                            if (requestedYearMax) return year === requestedYearMax;
                            return year >= requestedYearMin;
                        });

                        if (requestedBrand) {
                            items = items.filter(car => {
                                const brandStr = car.vehicleIdentity && car.vehicleIdentity.brand ? car.vehicleIdentity.brand.toLowerCase() : '';
                                const titleStr = (car.title || '').toLowerCase();
                                return brandStr.includes(brandStr) || titleStr.includes(requestedBrand);
                            });
                        }

                        if (requestedMileageMax) {
                            items = items.filter(car => {
                                let mileage = null;
                                if (typeof car.mileage === 'number') mileage = car.mileage;
                                else if (car.specs && typeof car.specs.mileage === 'number') mileage = car.specs.mileage;
                                else if (car.spec && typeof car.spec.mileage === 'number') mileage = car.spec.mileage;
                                if (mileage === null) return true;
                                return mileage <= requestedMileageMax;
                            });
                        }

                        const clientLimit = clientData.limit || 20;
                        const clientOffset = clientData.offset || 0;
                        const paginatedItems = items.slice(clientOffset, clientOffset + clientLimit);

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ items: paginatedItems }));
                    } catch (e) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Internal Server Error' }));
                    }
                });
            });

            proxyReq.on('error', () => {
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
