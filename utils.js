// 🔧 КОНФИГУРАЦИЯ
console.log('🌐 Current URL:', window.location.href);
const API_BASE_URL = window.location.origin;
console.log('🔗 API Base URL:', API_BASE_URL);

const tg = window.Telegram.WebApp;
const ADMIN_ID = 8036875641;

// 🔧 ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
let currentUser = null;
let currentChatId = null;
let currentAdminChat = null;
let selectedTaskId = null;
let allTasks = [];
let chatUpdateInterval = null;
let currentUserTaskId = null;
let currentVerificationId = null;
let currentTaskImage = null;

// 🔧 ИСПРАВЛЕННАЯ СИСТЕМА УРОВНЕЙ БЕЗ БОНУСОВ
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

// 🔧 ОСНОВНЫЕ УТИЛИТЫ
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

function scrollToTop() {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
}

// 🔧 ФУНКЦИИ ДЛЯ РАБОТЫ С ИЗОБРАЖЕНИЯМИ
function previewTaskImage(input) {
    if (!input.files || !input.files[0]) return;
    
    const file = input.files[0];
    const preview = document.getElementById('task-image-preview');
    const placeholder = document.querySelector('.upload-placeholder');
    
    currentTaskImage = file;
    
    if (!file.type.startsWith('image/')) {
        showNotification('Пожалуйста, выберите изображение', 'error');
        currentTaskImage = null;
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        showNotification('Размер изображения не должен превышать 5MB', 'error');
        currentTaskImage = null;
        return;
    }
    
    const reader = new FileReader();
    
    reader.onload = function(e) {
        preview.src = e.target.result;
        preview.style.display = 'block';
        if (placeholder) {
            placeholder.style.display = 'none';
        }
    };
    
    reader.onerror = function() {
        showNotification('Ошибка при загрузке изображения', 'error');
        currentTaskImage = null;
    };
    
    reader.readAsDataURL(file);
}

function clearTaskImage() {
    const input = document.getElementById('task-image-input');
    const preview = document.getElementById('task-image-preview');
    const placeholder = document.querySelector('.upload-placeholder');
    
    if (input) input.value = '';
    if (preview) {
        preview.src = '';
        preview.style.display = 'none';
    }
    if (placeholder) {
        placeholder.style.display = 'block';
    }
    
    currentTaskImage = null;
    
    const area = document.getElementById('image-upload-area');
    if (area) {
        area.style.borderColor = '';
        area.style.background = '';
    }
}

// 🔧 ФУНКЦИИ ДЛЯ РАБОТЫ С УРОВНЯМИ
function calculateUserLevel(completedTasks) {
    let currentLevel = 1;
    let tasksForCurrentLevel = 0;
    let tasksForNextLevel = LEVEL_SYSTEM[1].tasksRequired;
    let progressPercentage = 0;
    
    for (let level = 1; level <= Object.keys(LEVEL_SYSTEM).length; level++) {
        if (completedTasks >= LEVEL_SYSTEM[level].tasksRequired) {
            currentLevel = level;
        } else {
            break;
        }
    }
    
    const currentLevelRequirement = LEVEL_SYSTEM[currentLevel].tasksRequired;
    
    if (currentLevel < Object.keys(LEVEL_SYSTEM).length) {
        const nextLevelRequirement = LEVEL_SYSTEM[currentLevel + 1].tasksRequired;
        const tasksForCurrentLevel = completedTasks - currentLevelRequirement;
        const totalTasksForNextLevel = nextLevelRequirement - currentLevelRequirement;
        
        progressPercentage = Math.min(100, Math.round((tasksForCurrentLevel / totalTasksForNextLevel) * 100));
    } else {
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

// 🔧 ФУНКЦИИ ДЛЯ РАБОТЫ С ПРОФИЛЕМ
function displayUserProfile() {
    if (!currentUser) return;

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
    
    const userBalance = currentUser.balance || 0;
    if (balanceElement) balanceElement.textContent = `${userBalance} ⭐`;
    
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
    
    updateProfileStats();
    updateReferralSystem();
    updateLevelProgress();
}

function updateProfileStats() {
    if (!currentUser) return;
    
    const stats = document.querySelectorAll('.profile-stat .stat-value');
    if (stats.length >= 4) {
        stats[0].textContent = `${currentUser.balance || 0} ⭐`;
        stats[1].textContent = currentUser.tasks_completed || 0;
        stats[2].textContent = currentUser.active_tasks || 0;
        stats[3].textContent = `${calculateQualityRate() || 0}%`;
    }
}

function calculateQualityRate() {
    if (!currentUser) return 0;
    
    const completed = currentUser.tasks_completed || 0;
    const rejected = currentUser.tasks_rejected || 0;
    const total = completed + rejected;
    
    if (total === 0) return 0;
    
    return Math.round((completed / total) * 100);
}

function updateReferralSystem() {
    if (!currentUser) return;
    
    const referralCode = currentUser.referral_code || `ref_${currentUser.id}`;
    const referralLink = `https://t.me/LinkGoldMoney_bot?start=${referralCode}`;
    
    const referralInput = document.getElementById('referral-link');
    if (referralInput) referralInput.value = referralLink;
    
    const refInvited = document.getElementById('ref-invited');
    const refEarned = document.getElementById('ref-earned');
    
    if (refInvited) refInvited.textContent = currentUser.referral_count || 0;
    if (refEarned) refEarned.textContent = `${currentUser.referral_earned || 0} ⭐`;
    
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

// 🔧 ФУНКЦИИ ДЛЯ РАБОТЫ С TELEGRAM
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

function initializeTestUser() {
    currentUser = {
        id: '123456789',
        firstName: 'Тестовый',
        lastName: 'Пользователь',
        username: 'testuser',
        photoUrl: '',
        isAdmin: false,
        balance: 150,
        tasks_completed: 5,
        level: 1
    };
    
    initializeApp();
}

// 🔧 ОСНОВНЫЕ ФУНКЦИИ ПРИЛОЖЕНИЯ
async function initializeApp() {
    console.log('🎮 Initializing LinkGold app...');

    fixLayoutIssues();

    if (currentUser && (currentUser.is_admin || parseInt(currentUser.id) === ADMIN_ID)) {
        setTimeout(() => {
            loadReferralLinksList();
        }, 1000);
    }

    console.log('🚀 FORCE loading tasks on app start...');
    setTimeout(() => {
        if (currentUser) {
            console.log('👤 User authenticated, loading tasks...');
            loadTasksForCategory('new');
        } else {
            console.log('❌ No user for task loading');
        }
    }, 1000);

    initializeTaskTabHandlers();
    
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
    
    await refreshAdminRights();
    setupAdminPanel();
    displayUserProfile();
    checkAdminRights();
    loadMainPagePosts();
    
    console.log('🚀 Pre-loading tasks on app start...');
    loadTasks();
    
    initializeSearch();
    loadUserTasks();
    startUserDataAutoUpdate();
    
    if (currentUser && (currentUser.is_admin || parseInt(currentUser.id) === ADMIN_ID)) {
        loadAdminChats();
        loadAdminTasks();
        loadTaskVerifications();
        
        if (parseInt(currentUser.id) === ADMIN_ID) {
            setTimeout(() => {
                loadAdminsList();
            }, 500);
        }
    }
    
    setTimeout(fixLayoutIssues, 2000);
    await syncUserProfile();
    displayUserProfile();
    checkAdminRights();
    loadMainPagePosts();
    checkPageVisibility();
    loadTasks();
    updateProfileStats();
    updateActiveTasksCount();
    startUserDataAutoUpdate();

    console.log('🎉 App initialized successfully');
    setInterval(updateActiveTasksCount, 30000);
}

// 🔧 ФУНКЦИИ ДЛЯ РАБОТЫ С АДМИН-ПАНЕЛЬЮ
function checkAdminRights() {
    const adminNavItem = document.getElementById('admin-nav-item');
    
    const isMainAdmin = parseInt(currentUser?.id) === ADMIN_ID;
    const isRegularAdmin = currentUser?.is_admin === true;
    
    if (currentUser && (isMainAdmin || isRegularAdmin)) {
        if (adminNavItem) {
            adminNavItem.style.display = 'flex';
            console.log('✅ Admin nav item shown - user is admin');
        }
    } else {
        if (adminNavItem) {
            adminNavItem.style.display = 'none';
            console.log('❌ Admin nav item hidden - user is not admin');
        }
    }
}

async function refreshAdminRights() {
    if (!currentUser) return;
    
    try {
        console.log('🔄 Refreshing admin rights for user:', currentUser.id);
        
        const result = await makeRequest('/admin/refresh-rights', {
            method: 'POST',
            body: JSON.stringify({
                userId: currentUser.id
            })
        });
        
        if (result.success) {
            Object.assign(currentUser, result.user);
            
            console.log('✅ Admin rights refreshed:', {
                id: currentUser.id,
                is_admin: currentUser.is_admin,
                isMainAdmin: parseInt(currentUser.id) === ADMIN_ID
            });
            
            checkAdminRights();
            
        } else {
            const fallbackResult = await makeRequest(`/user/${currentUser.id}`);
            if (fallbackResult.success) {
                Object.assign(currentUser, fallbackResult.profile);
                checkAdminRights();
            }
        }
    } catch (error) {
        console.error('Ошибка обновления прав администратора:', error);
        try {
            const fallbackResult = await makeRequest(`/user/${currentUser.id}`);
            if (fallbackResult.success) {
                Object.assign(currentUser, fallbackResult.profile);
                checkAdminRights();
            }
        } catch (fallbackError) {
            console.error('Fallback method also failed:', fallbackError);
        }
    }
}

// 🔧 ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
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

function checkPageVisibility() {
    const adminTab = document.getElementById('admin-tab');
    if (!adminTab.classList.contains('active')) {
        resetAdminPanel();
    }
}

function resetAdminPanel() {
    console.log('🧹 Resetting admin panel display...');
    
    const allSections = document.querySelectorAll('.admin-section');
    allSections.forEach(section => {
        section.style.display = 'none';
    });
    
    const tasksContainer = document.getElementById('admin-tasks-list-container');
    if (tasksContainer) {
        tasksContainer.style.display = 'none';
    }
    
    console.log('✅ Admin panel reset complete');
}

// 🔧 ФУНКЦИИ ДЛЯ ОПТИМИЗАЦИИ И LAYOUT
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
});

// Обработчики событий
window.addEventListener('resize', fixLayoutIssues);
window.addEventListener('orientationchange', fixLayoutIssues);