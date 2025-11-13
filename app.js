// 🔧 ОСНОВНЫЕ ФУНКЦИИ ПРИЛОЖЕНИЯ

// Инициализация приложения
async function initializeApp() {
    console.log('🎮 Initializing LinkGold app...');

    // Применяем исправления layout сразу
    fixLayoutIssues();

    // 🔥 ВАЖНО: Загружаем ссылки при старте если пользователь админ
    if (currentUser && (currentUser.is_admin || parseInt(currentUser.id) === ADMIN_ID)) {
        setTimeout(() => {
            loadReferralLinksList();
        }, 1000);
    }

    // 🔥 ПРИНУДИТЕЛЬНАЯ ЗАГРУЗКА ЗАДАНИЙ ПРИ СТАРТЕ
    console.log('🚀 FORCE loading tasks on app start...');
    setTimeout(() => {
        if (currentUser) {
            console.log('👤 User authenticated, loading tasks...');
            loadTasksForCategory('new');
        } else {
            console.log('❌ No user for task loading');
        }
    }, 1000);

    // Остальной код инициализации...
    initializeTaskTabHandlers();

    // Проверяем соединение с API
    try {
        console.log('🔍 Testing API connection...');
        const health = await makeRequest('/api/health');
        console.log('✅ API connection successful:', health);

    } catch (error) {
        console.error('❌ API connection failed:', error);
        showNotification('❌ Не удалось подключиться', 'error');
        showRetryButton();
        return;
    }

    // Принудительно обновляем права администратора
    await refreshAdminRights();

    // Настраиваем админ-панель
    setupAdminPanel();

    // Сначала синхронизируем профиль с Telegram
    await syncUserProfile();

    // Затем инициализируем приложение
    displayUserProfile();
    checkAdminRights();
    loadMainPagePosts();
    checkPageVisibility();

    // Загружаем задания
    loadTasks();
    
    // Обновляем статистику профиля
    updateProfileStats();
    updateActiveTasksCount();

    // Запускаем автообновление данных
    startUserDataAutoUpdate();

    console.log('🎉 App initialized successfully');
    
    // Запускаем периодическое обновление
    setInterval(updateActiveTasksCount, 30000);
}

// Инициализация Telegram пользователя
async function initializeTelegramUser() {
    try {
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            const tgUser = tg.initDataUnsafe.user;

            currentUser = {
                id: tgUser.id,
                firstName: tgUser.first_name || 'Пользователь',
                lastName: tgUser.last_name || '',
                username: tgUser.username || `user_${tgUser.id}`,
                photoUrl: tgUser.photo_url || '',
                isAdmin: parseInt(tgUser.id) === ADMIN_ID
            };

            // Простая аутентификация без реферального кода
            try {
                const authResult = await makeRequest('/user/auth', {
                    method: 'POST',
                    body: JSON.stringify({
                        user: currentUser
                    })
                });

                if (authResult.success) {
                    Object.assign(currentUser, authResult.user);
                }
            } catch (authError) {
                console.log('Auth endpoint not available, continuing with basic user data');
            }

            initializeApp();
        } else {
            console.log('Telegram user data not available');
            initializeTestUser();
        }
    } catch (error) {
        console.error('Error initializing Telegram user:', error);
        initializeTestUser();
    }
}

// Тестовый пользователь для разработки
function initializeTestUser() {
    currentUser = {
        id: '123456789',
        firstName: 'Тестовый',
        lastName: 'Пользователь',
        username: 'testuser',
        photoUrl: '',
        isAdmin: true,
        balance: 150,
        tasks_completed: 5,
        level: 1
    };

    initializeApp();
}

// 🔧 ФУНКЦИИ ДЛЯ РАБОТЫ С API
async function makeRequest(endpoint, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        let url;
        if (endpoint.startsWith('http')) {
            url = endpoint;
        } else if (endpoint.startsWith('/api')) {
            url = API_BASE_URL + endpoint;
        } else {
            url = API_BASE_URL + '/api' + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
        }

        console.log(`🚀 Making ${options.method || 'GET'} request to: ${url}`);

        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            signal: controller.signal,
            ...options
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ HTTP ${response.status}: ${errorText}`);

            if (response.status === 403) {
                throw new Error('Доступ запрещен. У вас недостаточно прав.');
            } else if (response.status === 404) {
                throw new Error('Ресурс не найден.');
            } else if (response.status === 500) {
                throw new Error('Внутренняя ошибка сервера. Попробуйте позже.');
            } else if (response.status === 502) {
                throw new Error('Проблема с соединением. Сервер временно недоступен.');
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        }

        const data = await response.json();
        console.log('📨 Response received:', data);
        return data;

    } catch (error) {
        clearTimeout(timeoutId);
        console.error('💥 Request failed:', error);

        if (error.name === 'AbortError') {
            throw new Error('Таймаут запроса. Сервер не отвечает.');
        } else if (error.name === 'TypeError') {
            throw new Error('Проблема с сетью. Проверьте подключение к интернету.');
        } else if (error.message.includes('Failed to fetch')) {
            throw new Error('Не удалось подключиться к серверу. Проверьте интернет-соединение.');
        } else {
            throw error;
        }
    }
}

// 🔧 СИСТЕМА УРОВНЕЙ
const LEVEL_SYSTEM = {
    1: { tasksRequired: 10, name: "Новичок" },
    2: { tasksRequired: 20, name: "Ученик" },
    3: { tasksRequired: 30, name: "Опытный" },
    4: { tasksRequired: 40, name: "Профессионал" },
    5: { tasksRequired: 50, name: "Эксперт" },
    6: { tasksRequired: 60, name: "Мастер" },
    7: { tasksRequired: 70, name: "Гуру" },
    8: { tasksRequired: 80, name: "Легенда" },
    9: { tasksRequired: 90, name: "Император" },
    10: { tasksRequired: 100, name: "Бог заданий" }
};

function calculateUserLevel(completedTasks) {
    let currentLevel = 1;
    let tasksForCurrentLevel = 0;
    let tasksForNextLevel = LEVEL_SYSTEM[1].tasksRequired;
    let progressPercentage = 0;

    // Находим текущий уровень
    for (let level = 1; level <= Object.keys(LEVEL_SYSTEM).length; level++) {
        if (completedTasks >= LEVEL_SYSTEM[level].tasksRequired) {
            currentLevel = level;
        } else {
            break;
        }
    }

    // Расчет прогресса для текущего уровня
    const currentLevelRequirement = LEVEL_SYSTEM[currentLevel].tasksRequired;

    if (currentLevel < Object.keys(LEVEL_SYSTEM).length) {
        const nextLevelRequirement = LEVEL_SYSTEM[currentLevel + 1].tasksRequired;
        const tasksForCurrentLevel = completedTasks - currentLevelRequirement;
        const totalTasksForNextLevel = nextLevelRequirement - currentLevelRequirement;

        progressPercentage = Math.min(100, Math.round((tasksForCurrentLevel / totalTasksForNextLevel) * 100));
    } else {
        // Максимальный уровень достигнут
        progressPercentage = 100;
    }

    return {
        level: currentLevel,
        levelName: LEVEL_SYSTEM[currentLevel].name,
        completedTasks: completedTasks,
        progressPercentage: progressPercentage,
        isMaxLevel: currentLevel === Object.keys(LEVEL_SYSTEM).length
    };
}

function updateLevelProgress() {
    if (!currentUser) return;

    const completedTasks = currentUser.tasks_completed || 0;
    const levelInfo = calculateUserLevel(completedTasks);

    console.log('📊 Level progress calculation:', {
        completedTasks,
        level: levelInfo.level,
        percentage: levelInfo.progressPercentage
    });

    const progressBar = document.getElementById('level-progress-bar');
    const levelCount = document.querySelector('.level-count');
    const levelInfoText = document.querySelector('.level-info');

    if (progressBar) {
        progressBar.style.width = `${levelInfo.progressPercentage}%`;
    }

    if (levelCount) {
        if (levelInfo.isMaxLevel) {
            levelCount.textContent = "Макс. уровень!";
        } else {
            const nextLevelRequirement = LEVEL_SYSTEM[levelInfo.level + 1].tasksRequired;
            const tasksNeeded = nextLevelRequirement - completedTasks;
            levelCount.textContent = `${completedTasks}/${nextLevelRequirement}`;
        }
    }

    if (levelInfoText) {
        if (levelInfo.isMaxLevel) {
            levelInfoText.innerHTML = `🎉 Поздравляем! Вы достигли максимального уровня!`;
        } else {
            const nextLevelRequirement = LEVEL_SYSTEM[levelInfo.level + 1].tasksRequired;
            const tasksNeeded = nextLevelRequirement - completedTasks;
            levelInfoText.innerHTML =
                `Уровень <strong>${levelInfo.levelName}</strong> • ` +
                `До следующего уровня: <strong>${tasksNeeded}</strong> заданий`;
        }
    }
}

// 🔧 ОБНОВЛЕННОЕ АВТООБНОВЛЕНИЕ ДАННЫХ
function startUserDataAutoUpdate() {
    if (typeof currentUser === 'undefined' || !currentUser) {
        console.log('❌ currentUser не определен, откладываем автообновление');
        setTimeout(startUserDataAutoUpdate, 5000);
        return;
    }

    setInterval(async () => {
        if (typeof currentUser === 'undefined' || !currentUser) {
            console.log('❌ currentUser не определен в интервале');
            return;
        }

        try {
            const result = await makeRequest(`/user/${currentUser.id}`);
            if (result.success) {
                const oldLevel = currentUser.level;
                const oldTasksCompleted = currentUser.tasks_completed;

                currentUser = { ...currentUser, ...result.profile };

                displayUserProfile();
                updateLevelProgress();

                console.log('✅ Данные пользователя автообновлены');
            }
        } catch (error) {
            console.error('Ошибка автообновления данных пользователя:', error);
        }
    }, 30000);
}

// Обновление данных пользователя
async function updateUserData() {
    if (!currentUser) return;

    try {
        const result = await makeRequest(`/user/${currentUser.id}`);
        if (result.success) {
            currentUser = { ...currentUser, ...result.profile };
            displayUserProfile();
            console.log('✅ Данные пользователя обновлены:', currentUser.balance);
        }
    } catch (error) {
        console.error('Ошибка обновления данных пользователя:', error);
    }
}

// 🔧 ОБНОВЛЕННАЯ ФУНКЦИЯ ОТОБРАЖЕНИЯ ПРОФИЛЯ
function displayUserProfile() {
    if (!currentUser) return;

    // Обновляем основную информацию
    const firstNameElement = document.getElementById('user-first-name');
    const usernameElement = document.getElementById('user-username');
    const levelElement = document.getElementById('user-level');
    const balanceElement = document.getElementById('user-balance-main');

    if (firstNameElement) {
        const fullName = currentUser.lastName ?
            `${currentUser.firstName} ${currentUser.lastName}` :
            currentUser.firstName;
        firstNameElement.textContent = fullName;
    }

    if (usernameElement) usernameElement.textContent = currentUser.username || 'username';
    if (levelElement) levelElement.textContent = currentUser.level || 1;

    // Обновляем баланс во всех местах
    const userBalance = currentUser.balance || 0;
    if (balanceElement) balanceElement.textContent = `${userBalance} ⭐`;

    // Обновляем аватар
    const userPhotoElement = document.getElementById('user-photo');
    if (userPhotoElement && currentUser.photoUrl) {
        userPhotoElement.src = currentUser.photoUrl;
        userPhotoElement.alt = 'Фото профиля';
        userPhotoElement.style.display = 'block';
    } else if (userPhotoElement) {
        userPhotoElement.style.display = 'flex';
        userPhotoElement.style.alignItems = 'center';
        userPhotoElement.style.justifyContent = 'center';
        userPhotoElement.style.backgroundColor = '#6366f1';
        userPhotoElement.style.color = 'white';
        userPhotoElement.style.fontWeight = 'bold';
        userPhotoElement.style.borderRadius = '50%';
        userPhotoElement.textContent = currentUser.firstName ? currentUser.firstName.charAt(0).toUpperCase() : 'U';
    }

    // Обновляем статистику и прогресс
    updateProfileStats();
    updateReferralSystem();
    updateLevelProgress();

    // Добавляем реферальную информацию
    const referralInfo = document.getElementById('referral-info');
    if (referralInfo && currentUser) {
        if (currentUser.referred_by) {
            referralInfo.innerHTML = `
                <div style="background: var(--success-light); padding: 10px; border-radius: 8px; margin: 10px 0;">
                    <div style="font-size: 14px; color: var(--success);">
                        👥 Вы пришли по реферальной ссылке
                    </div>
                    <div style="font-size: 12px; color: var(--text-secondary);">
                        Вы получаете 90% от заработка, пригласивший - 10%
                    </div>
                </div>
            `;
        } else {
            referralInfo.innerHTML = `
                <div style="background: var(--bg-secondary); padding: 10px; border-radius: 8px; margin: 10px 0;">
                    <div style="font-size: 14px;">
                        🔗 Приглашайте друзей и получайте 10% от их заработка!
                    </div>
                </div>
            `;
        }
    }
}

function updateProfileStats() {
    if (!currentUser) return;

    const stats = document.querySelectorAll('.profile-stat .stat-value');
    if (stats.length >= 4) {
        // Баланс
        stats[0].textContent = `${currentUser.balance || 0} ⭐`;
        // Выполнено заданий
        stats[1].textContent = currentUser.tasks_completed || 0;
        // Активные задания
        stats[2].textContent = currentUser.active_tasks || 0;
        // Качество
        stats[3].textContent = `${calculateQualityRate() || 0}%`;
    }
}

// Функция расчета качества выполнения заданий
function calculateQualityRate() {
    if (!currentUser) return 0;

    const completed = currentUser.tasks_completed || 0;
    const rejected = currentUser.tasks_rejected || 0;
    const total = completed + rejected;

    if (total === 0) return 0;

    return Math.round((completed / total) * 100);
}

// Функция для получения активных заданий
async function updateActiveTasksCount() {
    if (!currentUser) return;

    try {
        const result = await makeRequest(`/user/${currentUser.id}/tasks/active-count`);
        if (result.success) {
            currentUser.active_tasks = result.count;
            updateProfileStats();
        }
    } catch (error) {
        console.error('Error loading active tasks count:', error);
    }
}

// 🔧 ОБНОВЛЕННАЯ ФУНКЦИЯ ОБНОВЛЕНИЯ РЕФЕРАЛЬНОЙ СИСТЕМЫ
function updateReferralSystem() {
    if (!currentUser) return;

    // Генерируем правильную реферальную ссылку
    const referralCode = currentUser.referral_code || `ref_${currentUser.id}`;
    const referralLink = `https://t.me/LinkGoldMoney_bot?start=${referralCode}`;

    const referralInput = document.getElementById('referral-link');
    if (referralInput) referralInput.value = referralLink;

    // Обновляем статистику
    const refInvited = document.getElementById('ref-invited');
    const refEarned = document.getElementById('ref-earned');

    if (refInvited) refInvited.textContent = currentUser.referral_count || 0;
    if (refEarned) refEarned.textContent = `${currentUser.referral_earned || 0} ⭐`;

    // 🔥 ОБНОВЛЯЕМ ТЕКСТ С НОВЫМИ УСЛОВИЯМИ
    const referralInfo = document.querySelector('.referral-info');
    if (referralInfo) {
        referralInfo.innerHTML = `
            🎁 <strong>Реферальная система:</strong><br>
            • Новый пользователь получает <strong>2⭐</strong> за переход по ссылке<br>
            • Вы получаете <strong>90%</strong> от своего заработка<br>
            • Пригласивший получает <strong>10%</strong> от вашего заработка<br>
            • Автоматически с каждого выполненного задания<br>
            • Ваш заработок с рефералов: <strong>${currentUser.referral_earned || 0} ⭐</strong><br>
            • Приглашено друзей: <strong>${currentUser.referral_count || 0}</strong><br><br>
            🔗 Просто отправьте другу эту ссылку в Telegram
        `;
    }
}

// 🔧 ФУНКЦИЯ ДЛЯ ПРОВЕРКИ РЕФЕРАЛЬНЫХ НАЧИСЛЕНИЙ
async function checkReferralEarnings() {
    if (!currentUser) return;

    try {
        const result = await makeRequest(`/api/user/${currentUser.id}/referral-earnings`);

        if (result.success) {
            if (result.earnings) {
                currentUser.referral_earned = result.earnings.total_earned || 0;
                currentUser.referral_count = result.earnings.referral_count || 0;
                updateReferralSystem();
            }
        }
    } catch (error) {
        console.error('Ошибка проверки реферальных начислений:', error);
    }
}

// 🔧 ФУНКЦИЯ ДЛЯ СИНХРОНИЗАЦИИ ПРОФИЛЯ С TELEGRAM
async function syncUserProfile() {
    if (!currentUser || !window.Telegram?.WebApp) return;

    try {
        const tg = window.Telegram.WebApp;
        const tgUser = tg.initDataUnsafe?.user;

        if (tgUser) {
            const updatedUser = {
                ...currentUser,
                firstName: tgUser.first_name || currentUser.firstName,
                lastName: tgUser.last_name || currentUser.lastName,
                username: tgUser.username || currentUser.username,
                photoUrl: tgUser.photo_url || currentUser.photoUrl
            };

            currentUser = updatedUser;
            displayUserProfile();

            console.log('✅ Профиль синхронизирован с Telegram');
        }
    } catch (error) {
        console.error('❌ Ошибка синхронизации профиля:', error);
    }
}

// 🔧 ФУНКЦИИ ДЛЯ ПРОКРУТКИ К НАЧАЛУ СТРАНИЦЫ
function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

// 🔧 ОБНОВЛЕННЫЕ ФУНКЦИИ ПОКАЗА СТРАНИЦ С ПРОКРУТКОЙ
function showWithdrawPage() {
    hideAllTabs();
    document.getElementById('withdraw-page').classList.add('active');

    updateWithdrawPage();
    loadWithdrawHistory();

    setTimeout(scrollToTop, 100);
}

function showHowItWorksPage() {
    hideAllTabs();
    document.getElementById('how-it-works-page').classList.add('active');
    setTimeout(scrollToTop, 100);
}

function showAboutPage() {
    hideAllTabs();
    document.getElementById('about-page').classList.add('active');
    setTimeout(scrollToTop, 100);
}

function goBackToProfile() {
    showProfileTab();
    setTimeout(scrollToTop, 100);
}

// 🔧 ОБНОВЛЕННАЯ ФУНКЦИЯ ПОКАЗА ПРОФИЛЯ
function showProfileTab() {
    hideAllTabs();
    document.getElementById('profile-tab').classList.add('active');
    updateNavState('profile');

    setTimeout(() => {
        updateUserData();
        syncUserProfile();
        checkReferralEarnings();
    }, 100);
}

// 🔧 ДОБАВЛЕНИЕ ПРОКРУТКИ К СУЩЕСТВУЮЩИМ ФУНКЦИЯМ
function showMainTab() {
    hideAllTabs();
    document.getElementById('main-tab').classList.add('active');
    updateNavState('main');
    setTimeout(scrollToTop, 100);
}

function showTasksTab() {
    console.log('🎯 ПЕРЕХОД НА ВКЛАДКУ ЗАДАНИЙ');

    hideAllTabs();
    const tasksTab = document.getElementById('tasks-tab');
    if (tasksTab) {
        tasksTab.classList.add('active');
    }

    updateNavState('tasks');
    setTimeout(fixMobileLayout, 100);

    setTimeout(() => {
        showTaskCategory('new');
        scrollToTop();
    }, 150);
}

function showAdminTab() {
    const isMainAdmin = parseInt(currentUser?.id) === ADMIN_ID;
    const isRegularAdmin = currentUser?.is_admin === true;

    if (!currentUser || (!isMainAdmin && !isRegularAdmin)) {
        showNotification('Доступ запрещен!', 'error');
        return;
    }

    hideAllTabs();
    document.getElementById('admin-tab').classList.add('active');
    updateNavState('admin');

    resetAdminPanel();
    showAdminSection('posts');

    setTimeout(scrollToTop, 100);

    if (isMainAdmin) {
        setTimeout(() => {
            loadAdminsList();
        }, 500);
    }
}

// 🔧 ОБНОВЛЕННЫЕ ФУНКЦИИ ДЛЯ КНОПОК В ПРОФИЛЕ
document.querySelectorAll('.profile-action').forEach(action => {
    action.addEventListener('click', function() {
        setTimeout(scrollToTop, 50);
    });
});

// 🔧 ФИКС ДЛЯ МОБИЛЬНЫХ УСТРОЙСТВ
function fixMobileScroll() {
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }

    window.addEventListener('load', function() {
        setTimeout(scrollToTop, 100);
    });
}

// Инициализация фикса прокрутки
fixMobileScroll();

// 🔧 ФУНКЦИЯ ДЛЯ ПРИНУДИТЕЛЬНОГО ИСПРАВЛЕНИЯ LAYOUT
function fixLayoutIssues() {
    console.log('🔧 Applying layout fixes...');

    const elements = document.querySelectorAll('*');
    elements.forEach(el => {
        el.style.maxWidth = '100%';
        el.style.boxSizing = 'border-box';
    });

    const tasksGrid = document.querySelector('.tasks-grid');
    if (tasksGrid) {
        tasksGrid.style.width = '100%';
        tasksGrid.style.margin = '0';
        tasksGrid.style.padding = '0';
        tasksGrid.style.overflow = 'hidden';
    }

    const taskCards = document.querySelectorAll('.task-card');
    taskCards.forEach(card => {
        card.style.width = '100%';
        card.style.maxWidth = '100%';
        card.style.boxSizing = 'border-box';
        card.style.margin = '0 0 12px 0';
        card.style.overflow = 'hidden';
    });

    document.body.style.overflowX = 'hidden';
    document.documentElement.style.overflowX = 'hidden';

    console.log('✅ Layout fixes applied');
}

// 🔧 ФУНКЦИЯ ДЛЯ ОБНОВЛЕНИЯ РАЗМЕРОВ ПРИ ИЗМЕНЕНИИ ЭКРАНА
function updateLayoutOnResize() {
    fixLayoutIssues();
}

// Вызываем при загрузке и изменении размера
document.addEventListener('DOMContentLoaded', fixLayoutIssues);
window.addEventListener('resize', updateLayoutOnResize);
window.addEventListener('orientationchange', updateLayoutOnResize);

// 🔧 ФУНКЦИЯ ДЛЯ ПРИНУДИТЕЛЬНОГО ИСПРАВЛЕНИЯ РАЗМЕТКИ НА МОБИЛЬНЫХ
function fixMobileLayout() {
    console.log('🔧 Applying mobile layout fixes...');

    const tasksGrid = document.querySelector('.tasks-grid');
    if (tasksGrid) {
        tasksGrid.style.width = '100%';
        tasksGrid.style.margin = '0';
        tasksGrid.style.padding = '0';
        tasksGrid.style.overflow = 'hidden';
    }

    const taskCards = document.querySelectorAll('.task-card');
    taskCards.forEach(card => {
        card.style.width = '100%';
        card.style.maxWidth = '100%';
        card.style.boxSizing = 'border-box';
        card.style.margin = '0 0 12px 0';
        card.style.overflow = 'hidden';
    });

    document.body.style.overflowX = 'hidden';
    document.documentElement.style.overflowX = 'hidden';

    console.log('✅ Mobile layout fixes applied');
}

// 🔧 ОПТИМИЗАЦИИ ПРОИЗВОДИТЕЛЬНОСТИ
class PerformanceOptimizer {
    constructor() {
        this.lazyLoadObserver = null;
        this.init();
    }

    init() {
        this.setupLazyLoading();
        this.debounceScrollEvents();
        this.optimizeAnimations();
    }

    setupLazyLoading() {
        if ('IntersectionObserver' in window) {
            this.lazyLoadObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        img.classList.remove('lazy');
                        this.lazyLoadObserver.unobserve(img);
                    }
                });
            });

            document.querySelectorAll('img[data-src]').forEach(img => {
                this.lazyLoadObserver.observe(img);
            });
        }
    }

    debounceScrollEvents() {
        let scrollTimeout;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                // Оптимизированные операции при скролле
            }, 100);
        }, { passive: true });
    }

    optimizeAnimations() {
        const elements = document.querySelectorAll('.card, .task-card');
        elements.forEach(el => {
            el.style.transform = 'translateZ(0)';
        });
    }
}

// Эффективное обновление DOM
class DOMOptimizer {
    constructor() {
        this.updateQueue = [];
        this.batchTimeout = null;
    }

    batchUpdate(callback) {
        this.updateQueue.push(callback);

        if (!this.batchTimeout) {
            this.batchTimeout = setTimeout(() => {
                this.flushUpdates();
            }, 16);
        }
    }

    flushUpdates() {
        const fragment = document.createDocumentFragment();

        this.updateQueue.forEach(callback => {
            callback(fragment);
        });

        document.getElementById('tasks-container').appendChild(fragment);

        this.updateQueue = [];
        this.batchTimeout = null;
    }

    createElement(tag, attributes = {}) {
        const element = document.createElement(tag);
        Object.keys(attributes).forEach(key => {
            element[key] = attributes[key];
        });
        return element;
    }
}

// Кэширование запросов
const apiCache = new Map();

async function cachedRequest(url, options = {}) {
    const cacheKey = JSON.stringify({ url, options });

    if (apiCache.has(cacheKey)) {
        return apiCache.get(cacheKey);
    }

    const response = await fetch(url, options);
    const data = await response.json();

    apiCache.set(cacheKey, data);
    setTimeout(() => apiCache.delete(cacheKey), 30000);

    return data;
}

// Мемоизация тяжелых функций
function memoize(fn) {
    const cache = new Map();
    return function(...args) {
        const key = JSON.stringify(args);
        if (cache.has(key)) return cache.get(key);

        const result = fn.apply(this, args);
        cache.set(key, result);
        return result;
    };
}

// Критическая загрузка по приоритету
class PriorityLoader {
    constructor() {
        this.priorityQueue = [];
    }

    addCritical(resource, priority = 0) {
        this.priorityQueue.push({ resource, priority });
        this.priorityQueue.sort((a, b) => b.priority - a.priority);
    }

    async load() {
        for (const item of this.priorityQueue) {
            await this.loadResource(item.resource);
        }
    }

    async loadResource(resource) {
        if (resource.type === 'script') {
            await this.loadScript(resource.url);
        } else if (resource.type === 'data') {
            await this.loadData(resource.url);
        }
    }
}

// Определяем медленные устройства
function isSlowDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        && /3G|2G|slow|reduce/i.test(navigator.connection.effectiveType);
}

if (isSlowDevice()) {
    document.documentElement.classList.add('simplified-mode');

    window.addEventListener('load', function() {
        const heavyElements = document.querySelectorAll('.hero-banner, .complex-animation');
        heavyElements.forEach(el => el.remove());
    });
}

// 🔧 ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatPostDate(timestamp) {
    if (!timestamp) return '';

    const date = new Date(timestamp);
    const moscowTime = new Date(date.getTime() + (3 * 60 * 60 * 1000));

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const postDate = new Date(moscowTime.getFullYear(), moscowTime.getMonth(), moscowTime.getDate());

    const diffTime = now - date;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return `Сегодня, ${moscowTime.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Moscow'
        })} (МСК)`;
    } else if (diffDays === 1) {
        return `Вчера, ${moscowTime.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Moscow'
        })} (МСК)`;
    } else {
        return `${moscowTime.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            timeZone: 'Europe/Moscow'
        })}, ${moscowTime.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Moscow'
        })} (МСК)`;
    }
}

function showNotification(message, type = 'info') {
    document.querySelectorAll('.notification').forEach(notification => {
        notification.remove();
    });

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">${message}</div>
        <button class="notification-close" onclick="this.parentElement.remove()">×</button>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

function checkPageVisibility() {
    const adminTab = document.getElementById('admin-tab');
    if (!adminTab.classList.contains('active')) {
        resetAdminPanel();
    }
}

// Функция для кнопки повторной попытки
function showRetryButton() {
    const retryBtn = document.createElement('button');
    retryBtn.textContent = '🔄 Попробовать снова';
    retryBtn.className = 'btn btn-primary';
    retryBtn.style.margin = '20px auto';
    retryBtn.style.display = 'block';
    retryBtn.onclick = function() {
        retryBtn.remove();
        initializeApp();
    };

    document.body.appendChild(retryBtn);
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    console.log('Initializing LinkGold app...');

    if (typeof tg !== 'undefined') {
        tg.expand();
        tg.ready();
        initializeTelegramUser();
    } else {
        console.log('Telegram Web App context not available');
        initializeTestUser();
    }

    // Инициализация ripple эффектов
    initializeRippleEffects();

    // Оптимизация анимаций
    optimizeAnimations();

    // Ленивая загрузка изображений
    lazyLoadImages();

    // Предзагрузка ресурсов
    preloadResources();

    // Оптимизация для тач-устройств
    if ('ontouchstart' in window) {
        document.body.classList.add('touch-device');
    }

    console.log('🚀 Smooth animations initialized');
});

// 🔧 ЭКСПОРТ ФУНКЦИЙ
window.initializeApp = initializeApp;
window.showMainTab = showMainTab;
window.showTasksTab = showTasksTab;
window.showProfileTab = showProfileTab;
window.showAdminTab = showAdminTab;
window.showWithdrawPage = showWithdrawPage;
window.showHowItWorksPage = showHowItWorksPage;
window.showAboutPage = showAboutPage;
window.goBackToProfile = goBackToProfile;
window.updateUserData = updateUserData;
window.displayUserProfile = displayUserProfile;
window.checkReferralEarnings = checkReferralEarnings;
window.syncUserProfile = syncUserProfile;
window.scrollToTop = scrollToTop;
window.fixLayoutIssues = fixLayoutIssues;
window.fixMobileLayout = fixMobileLayout;
window.escapeHtml = escapeHtml;
window.formatPostDate = formatPostDate;
window.showNotification = showNotification;
window.calculateUserLevel = calculateUserLevel;
window.updateLevelProgress = updateLevelProgress;