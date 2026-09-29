import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore,
    doc,
    setDoc,
    deleteDoc,
    collection,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Конфигурация Firebase
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCp-qPQ6SGjFTLP8U-wUpz3IkZ2plPpnqw",
  authDomain: "blue-bird-eco-technology.firebaseapp.com",
  projectId: "blue-bird-eco-technology",
  storageBucket: "blue-bird-eco-technology.firebasestorage.app",
  messagingSenderId: "800119589204",
  appId: "1:800119589204:web:11385241924436cc3220c1",
  measurementId: "G-N0JJK25ELV"
};

// Инициализация Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Состояние и глобальные ссылки
let currentUser = null;
let unsubscribeFavorites = null;
const userFavoritesMap = new Map(); // Хранит загруженные из Firestore автомобили

// Элементы модального окна профиля
const profileAvatar = document.getElementById("profileAvatar");
const profileAvatarFallback = document.getElementById("profileAvatarFallback");
const profileName = document.getElementById("profileName");
const profileEmail = document.getElementById("profileEmail");
const profileSignOut = document.getElementById("profileSignOut");
const profileFavorites = document.getElementById("profileFavorites");
const profileFavoritesStatus = document.getElementById("profileFavoritesStatus");
const accountContent = document.getElementById("accountContent");
const accountGuest = document.getElementById("accountGuest");

// Форма авторизации (на login.html)
const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authError = document.getElementById("authError");
const signUpBtn = document.getElementById("signUpBtn");
const googleBtn = document.getElementById("googleBtn");

// -------------------------------------------------------------
// 1. Управление состоянием авторизации и синхронизация Firestore
// -------------------------------------------------------------
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    updateAccountUI(user);
    const accountLoading = document.getElementById("accountLoading");
    if (accountLoading) accountLoading.hidden = true;
    if (accountContent) accountContent.hidden = !user;
    if (accountGuest) accountGuest.hidden = Boolean(user);

    if (unsubscribeFavorites) {
        unsubscribeFavorites();
        unsubscribeFavorites = null;
    }

    if (user) {
        // Подписка на коллекцию 'favorites' текущего пользователя
        const favsRef = collection(db, "users", user.uid, "favorites");
        unsubscribeFavorites = onSnapshot(favsRef, (snapshot) => {
            userFavoritesMap.clear();
            snapshot.forEach((docSnap) => {
                userFavoritesMap.set(docSnap.id, docSnap.data());
            });
            updateFavoriteButtonsUI();
            renderProfileFavorites();
        }, (error) => {
            console.error("Error loading favorites from Firestore:", error);
        });
    } else {
        userFavoritesMap.clear();
        updateFavoriteButtonsUI();
        renderProfileFavorites();
    }
});

document.addEventListener("change", (event) => {
    if (event.target.id === "languageSelect") {
        updateAccountUI(currentUser);
    }
});

// -------------------------------------------------------------
// 2. Обработка избранного (Firestore setDoc / deleteDoc)
// -------------------------------------------------------------
async function handleFavoriteToggle(button) {
    if (!currentUser) {
        window.location.href = "login.html";
        return;
    }

    const carId = button.dataset.carId;
    if (!carId) return;

    const favDocRef = doc(db, "users", currentUser.uid, "favorites", String(carId));
    const isCurrentlyFavorite = userFavoritesMap.has(String(carId));

    try {
        if (isCurrentlyFavorite) {
            await deleteDoc(favDocRef);
        } else {
            const favoriteData = {
                id: String(carId),
                title: button.dataset.title || "",
                image: button.dataset.image || "",
                year: String(button.dataset.year || ""),
                price: String(button.dataset.price || ""),
                updatedAt: new Date().toISOString()
            };
            await setDoc(favDocRef, favoriteData);
        }
    } catch (error) {
        console.error("Failed to update favorites in Firestore:", error);
    }
}

// Глобальный слушатель кликов по кнопкам "Добавить в избранное"
document.addEventListener("click", (event) => {
    const favButton = event.target.closest("[data-favorite-button]");
    if (favButton) {
        handleFavoriteToggle(favButton);
    }
});

// Событие обновления списка (для принудительной синхронизации UI)
document.addEventListener("bluebird-favorites-refresh", () => {
    updateFavoriteButtonsUI();
});

// Обновление состояния кнопок в интерфейсе
function updateFavoriteButtonsUI() {
    const favButtons = document.querySelectorAll("[data-favorite-button]");
    favButtons.forEach((btn) => {
        const carId = btn.dataset.carId;
        const isFav = carId && userFavoritesMap.has(String(carId));

        btn.setAttribute("aria-pressed", isFav ? "true" : "false");
        btn.textContent = isFav ? "★" : "☆";
        btn.classList.toggle("is-active", isFav);
    });
}

// -------------------------------------------------------------
// 3. Отображение списка избранного в модальном окне профиля
// -------------------------------------------------------------
function renderProfileFavorites() {
    if (!profileFavorites) return;

    profileFavorites.replaceChildren();

    if (!currentUser) {
        if (profileFavoritesStatus) profileFavoritesStatus.textContent = "";
        return;
    }

    if (userFavoritesMap.size === 0) {
        if (profileFavoritesStatus) {
            const lang = document.documentElement.lang || "en";
            profileFavoritesStatus.textContent = lang === "ar" ? "لا توجد سيارات مفضلة" : "No favorites added yet.";
        }
        return;
    }

    if (profileFavoritesStatus) profileFavoritesStatus.textContent = "";

    userFavoritesMap.forEach((car) => {
        const item = document.createElement("div");
        item.className = "profile-favorite-item";

        const img = document.createElement("img");
        img.src = car.image || "assets/images/logo.png";
        img.alt = car.title || "Car";

        const info = document.createElement("div");
        info.className = "profile-favorite-info";

        const title = document.createElement("a");
        title.href = `car-details.html?id=${encodeURIComponent(car.id)}`;
        title.textContent = car.title || `Car #${car.id}`;

        const details = document.createElement("p");
        details.textContent = [car.year, car.price ? `${car.price} KRW` : ""].filter(Boolean).join(" · ");

        info.append(title, details);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "favorite-remove-btn";
        removeBtn.textContent = "×";
        removeBtn.dataset.favoriteButton = "";
        removeBtn.dataset.carId = car.id;

        item.append(img, info, removeBtn);
        profileFavorites.append(item);
    });

    updateFavoriteButtonsUI();
}

// -------------------------------------------------------------
// 4. Логика авторизации и профиля
// -------------------------------------------------------------
function updateAccountUI(user) {
    const accountButtons = document.querySelectorAll("[data-account-button]");

    accountButtons.forEach((btn) => {
        const nameSpan = btn.querySelector(".account-name");
        const avatarImg = btn.querySelector(".account-avatar");
        const fallbackSpan = btn.querySelector(".account-avatar-fallback");
        const accountIcon = btn.querySelector(".mobile-account-icon");
        if (accountIcon) accountIcon.classList.toggle("is-hidden", Boolean(user));

        if (user) {
            const displayName = user.displayName || user.email?.split("@")[0] || "Account";
            if (nameSpan && !btn.classList.contains("mobile-account-button")) nameSpan.textContent = displayName;

            if (user.photoURL) {
                if (avatarImg) {
                    avatarImg.src = user.photoURL;
                    avatarImg.hidden = false;
                }
                if (fallbackSpan) fallbackSpan.hidden = true;
            } else {
                if (avatarImg) avatarImg.hidden = true;
                if (fallbackSpan) {
                    fallbackSpan.textContent = displayName.charAt(0).toUpperCase();
                    fallbackSpan.hidden = false;
                }
            }
        } else {
            const lang = document.documentElement.lang || "en";
            if (nameSpan) {
                nameSpan.textContent = btn.classList.contains("mobile-account-button")
                    ? (lang === "ar" ? "الحساب" : "Account")
                    : (lang === "ar" ? "تسجيل الدخول" : "Sign in");
            }
            if (avatarImg) avatarImg.hidden = true;
            if (fallbackSpan) fallbackSpan.hidden = true;
        }
    });

    if (user && profileName && profileEmail) {
        profileName.textContent = user.displayName || user.email?.split("@")[0] || "Account";
        profileEmail.textContent = user.email || "";

        if (user.photoURL && profileAvatar) {
            profileAvatar.src = user.photoURL;
            profileAvatar.hidden = false;
            if (profileAvatarFallback) profileAvatarFallback.hidden = true;
        } else if (profileAvatarFallback) {
            profileAvatarFallback.textContent = (user.displayName || user.email || "A").charAt(0).toUpperCase();
            profileAvatarFallback.hidden = false;
            if (profileAvatar) profileAvatar.hidden = true;
        }
    }
}

// Клики по кнопке профиля / входа
document.querySelectorAll("[data-account-button]").forEach((btn) => {
    btn.addEventListener("click", () => {
        window.location.href = "account.html";
    });
});

if (profileSignOut) {
    profileSignOut.addEventListener("click", async () => {
        await signOut(auth);
        window.location.reload();
    });
}

// Логика формы на странице login.html
if (authForm) {
    authForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        showAuthError("");

        try {
            await signInWithEmailAndPassword(auth, authEmail.value, authPassword.value);
            window.location.href = "index.html";
        } catch (error) {
            showAuthError(error.message);
        }
    });

    if (signUpBtn) {
        signUpBtn.addEventListener("click", async () => {
            showAuthError("");
            if (!authEmail.value || !authPassword.value) {
                showAuthError("Please fill in email and password.");
                return;
            }

            try {
                await createUserWithEmailAndPassword(auth, authEmail.value, authPassword.value);
                window.location.href = "index.html";
            } catch (error) {
                showAuthError(error.message);
            }
        });
    }

    if (googleBtn) {
        googleBtn.addEventListener("click", async () => {
            showAuthError("");
            try {
                await signInWithPopup(auth, googleProvider);
                window.location.href = "index.html";
            } catch (error) {
                showAuthError(error.message);
            }
        });
    }
}

function showAuthError(msg) {
    if (!authError) return;
    if (msg) {
        authError.textContent = msg;
        authError.hidden = false;
    } else {
        authError.textContent = "";
        authError.hidden = true;
    }
}