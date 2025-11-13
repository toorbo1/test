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
let allAdminTasks = [];
let currentAdminSearchTerm = '';

// Функции для работы с загрузкой изображений
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

function initImageUploadDragDrop() {
    const area = document.getElementById('image-upload-area');
    if (!area) return;
    
    area.addEventListener('dragover', function(e) {
        e.preventDefault();
        area.classList.add('dragover');
        area.style.borderColor = 'var(--accent)';
        area.style.background = 'rgba(99, 102, 241, 0.05)';
    });
    
    area.addEventListener('dragleave', function(e) {
        e.preventDefault();
        area.classList.remove('dragover');
        area.style.borderColor = '';
        area.style.background = '';
    });
    
    area.addEventListener('drop', function(e) {
        e.preventDefault();
        area.classList.remove('dragover');
        area.style.borderColor = '';
        area.style.background = '';
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const fileInput = document.getElementById('task-image-input');
            if (fileInput) {
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(files[0]);
                fileInput.files = dataTransfer.files;
                previewTaskImage(fileInput);
            }
        }
    });
    
    area.addEventListener('click', function() {
        const fileInput = document.getElementById('task-image-input');
        if (fileInput) {
            fileInput.click();
        }
    });
}

// 🔧 ПОИСКОВАЯ СИСТЕМА ДЛЯ АДМИНСКИХ ЗАДАНИЙ
function initAdminTaskSearch() {
    const searchInput = document.getElementById('admin-task-search');
    if (searchInput) {
        let searchTimeout;
        
        searchInput.addEventListener('input', function(e) {
            clearTimeout(searchTimeout);
            const searchText = e.target.value.trim();
            
            searchTimeout = setTimeout(() => {
                if (searchText.length >= 2 || searchText.length === 0) {
                    searchAdminTasks(searchText);
                }
            }, 300);
        });

        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                searchAdminTasks(searchInput.value.trim());
            }
        });
    }
}

async function searchAdminTasks(searchTerm = '') {
    console.log('🔍 Searching admin tasks:', searchTerm);
    
    currentAdminSearchTerm = searchTerm;
    
    const clearBtn = document.querySelector('.admin-search-clear');
    if (clearBtn) {
        clearBtn.style.display = searchTerm ? 'block' : 'none';
    }

    try {
        if (!currentUser) {
            showNotification('Пользователь не авторизован', 'error');
            return;
        }

        const resultsDiv = document.getElementById('admin-search-results');
        if (resultsDiv) {
            resultsDiv.innerHTML = '<span style="color: var(--warning);">⏳ Ищем задания...</span>';
        }

        const params = new URLSearchParams();
        params.append('adminId', currentUser.id);
        if (searchTerm) {
            params.append('search', searchTerm);
        }

        const url = `/api/admin/tasks/search?${params.toString()}`;
        console.log('📡 Search URL:', url);

        const result = await makeRequest(url);
        
        if (result.success) {
            allAdminTasks = result.tasks || [];
            displayAdminTasks(allAdminTasks, result.statistics);
            updateSearchResultsInfo(searchTerm, allAdminTasks.length);
        } else {
            throw new Error(result.error || 'Ошибка поиска');
        }

    } catch (error) {
        console.error('❌ Search error:', error);
        const resultsDiv = document.getElementById('admin-search-results');
        if (resultsDiv) {
            resultsDiv.innerHTML = `<span style="color: var(--error);">❌ Ошибка поиска: ${error.message}</span>`;
        }
        showNotification('Ошибка поиска заданий', 'error');
    }
}

function updateSearchResultsInfo(searchTerm, resultsCount) {
    const resultsDiv = document.getElementById('admin-search-results');
    if (!resultsDiv) return;

    if (!searchTerm) {
        resultsDiv.innerHTML = '';
        return;
    }

    if (resultsCount === 0) {
        resultsDiv.innerHTML = `
            <span style="color: var(--text-secondary);">
                🔍 По запросу "<strong>${escapeHtml(searchTerm)}</strong>" ничего не найдено
            </span>
        `;
    } else {
        resultsDiv.innerHTML = `
            <span style="color: var(--success);">
                ✅ Найдено <strong>${resultsCount}</strong> заданий по запросу "<strong>${escapeHtml(searchTerm)}</strong>"
            </span>
        `;
    }
}

function clearAdminTaskSearch() {
    const searchInput = document.getElementById('admin-task-search');
    if (searchInput) {
        searchInput.value = '';
        searchAdminTasks('');
    }
}

// Загрузка админских заданий
async function loadAdminTasks() {
    console.log('🎯 Loading admin tasks...');
    
    if (!currentUser) {
        console.log('❌ No user');
        return;
    }
    
    const container = document.getElementById('admin-tasks-list');
    if (!container) {
        console.log('❌ Container not found');
        return;
    }
    
    const tasksContainer = document.getElementById('admin-tasks-list-container');
    if (tasksContainer) {
        tasksContainer.style.display = 'block';
    }
    
    container.innerHTML = `
        <div style="text-align: center; padding: 40px 20px;">
            <div class="loading-spinner">⏳</div>
            <div style="margin-top: 16px;">Загружаем задания админа...</div>
        </div>
    `;
    
    try {
        const [statsResult, tasksResult] = await Promise.all([
            makeRequest(`/api/admin/tasks-stats?adminId=${currentUser.id}`),
            makeRequest(`/api/admin/simple-tasks?adminId=${currentUser.id}`)
        ]);
        
        console.log('📊 Stats result:', statsResult);
        console.log('📊 Tasks result:', tasksResult);
        
        if (tasksResult.success && statsResult.success) {
            const allAdminTasks = tasksResult.tasks || [];
            displayAdminTasks(allAdminTasks, statsResult.statistics);
        } else {
            throw new Error(tasksResult.error || statsResult.error || 'Unknown error');
        }
        
    } catch (error) {
        console.error('💥 Error:', error);
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--error);">
                <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
                <div>Ошибка загрузки заданий</div>
                <div style="font-size: 12px; margin-top: 8px;">${error.message}</div>
                
                <div style="margin-top: 20px;">
                    <button class="btn btn-primary" onclick="loadAdminTasks()">
                        🔄 Попробовать снова
                    </button>
                </div>
            </div>
        `;
    }
}

function displayAdminTasks(tasks, stats) {
    const container = document.getElementById('admin-tasks-list');
    if (!container) {
        console.error('❌ Admin tasks container not found!');
        return;
    }
    
    console.log(`🎯 Displaying ${tasks ? tasks.length : 0} admin tasks`);
    
    container.innerHTML = '';
    
    if (stats) {
        const completedCount = stats.completed_tasks || 0;
        const rejectedCount = stats.rejected_tasks || 0;
        const pendingCount = stats.pending_tasks || 0;
        const activeCount = stats.active_tasks || 0;
        const totalCount = stats.total_tasks || 0;
        
        const statsHTML = `
            <div class="admin-stats" style="margin-bottom: 20px; padding: 15px; background: var(--card-bg); border-radius: 12px; border: 1px solid var(--border);">
                <h4 style="margin-bottom: 10px;">📊 Статистика заданий</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; font-size: 12px;">
                    <div style="text-align: center;">
                        <div style="font-size: 18px; font-weight: bold; color: var(--accent);">${totalCount}</div>
                        <div>Всего заданий</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 18px; font-weight: bold; color: var(--success);">${completedCount}</div>
                        <div>✅ Выполнено</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 18px; font-weight: bold; color: var(--error);">${rejectedCount}</div>
                        <div>❌ Отклонено</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 18px; font-weight: bold; color: var(--warning);">${pendingCount}</div>
                        <div>⏳ На проверке</div>
                    </div>
                </div>
            </div>
        `;
        container.innerHTML = statsHTML;
    }
    
    if (!tasks || tasks.length === 0) {
        container.innerHTML += `
            <div class="no-tasks" style="text-align: center; padding: 40px 20px; background: var(--card-bg); border-radius: 12px; border: 1px solid var(--border);">
                <div style="font-size: 48px; margin-bottom: 16px;">📝</div>
                <div style="font-size: 18px; margin-bottom: 8px;">Нет созданных заданий</div>
                <div style="font-size: 14px; color: var(--text-secondary);">
                    Создайте первое задание используя форму выше
                </div>
            </div>
        `;
        return;
    }
    
    const filterHTML = `
        <div class="task-filter" style="margin-bottom: 15px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <label style="font-weight: 600; color: var(--text-primary);">Фильтр:</label>
            <select id="admin-task-filter" onchange="filterAdminTasks()" style="padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-primary); color: var(--text-primary);">
                <option value="all">Все задания</option>
                <option value="active">Только активные</option>
                <option value="completed">Только завершенные</option>
                <option value="my">Мои задания</option>
            </select>
            <button onclick="loadAdminTasks()" class="btn btn-primary" style="padding: 8px 12px; font-size: 12px;">
                🔄 Обновить
            </button>
        </div>
    `;
    container.innerHTML += filterHTML;
    
    const tasksContainer = document.createElement('div');
    tasksContainer.id = 'admin-tasks-container';
    container.appendChild(tasksContainer);
    
    window.currentAdminTasks = tasks;
    renderAdminTasks(tasks);
}

function renderAdminTasks(tasks) {
    const container = document.getElementById('admin-tasks-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    const filter = document.getElementById('admin-task-filter')?.value || 'all';
    
    const filteredTasks = tasks.filter(task => {
        switch (filter) {
            case 'active':
                return task.status === 'active';
            case 'completed':
                return task.status === 'completed';
            case 'my':
                return task.created_by === currentUser.id;
            default:
                return true;
        }
    });
    
    console.log(`🎯 Rendering ${filteredTasks.length} filtered tasks (filter: ${filter})`);
    
    if (filteredTasks.length === 0) {
        container.innerHTML = `
            <div class="no-tasks" style="text-align: center; padding: 40px 20px;">
                <div style="font-size: 48px; margin-bottom: 16px;">🔍</div>
                <div>Заданий не найдено</div>
                <div style="font-size: 14px; color: var(--text-secondary); margin-top: 8px;">
                    Попробуйте изменить фильтр
                </div>
            </div>
        `;
        return;
    }
    
    filteredTasks.forEach(task => {
        const taskElement = createAdminTaskElement(task);
        container.appendChild(taskElement);
    });
}

function createAdminTaskElement(task) {
    const taskElement = document.createElement('div');
    taskElement.className = 'admin-task-item';
    taskElement.style.cssText = `
        background: var(--card-bg);
        border: 1px solid ${task.status === 'completed' ? 'var(--success)' : 'var(--border)'};
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 12px;
        opacity: ${task.status === 'completed' ? 0.8 : 1};
    `;
    
    const completedCount = task.completed_count || 0;
    const peopleRequired = task.people_required || 1;
    const progressPercentage = Math.min(100, (completedCount / peopleRequired) * 100);
    const isCompleted = task.status === 'completed';
    
    taskElement.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 16px; margin-bottom: 4px;">
                    ${task.title}
                    ${isCompleted ? ' <span style="color: var(--success); font-size: 12px;">(Завершено)</span>' : ''}
                </div>
                <div style="color: var(--text-secondary); font-size: 14px;">${task.description}</div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <div style="font-size: 20px; color: var(--gold); font-weight: 600;">
                    ${task.price} ⭐
                </div>
                ${!isCompleted ? `
                    <button class="admin-task-delete" onclick="deleteTask(${task.id})" style="background: var(--error); color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer;">
                        🗑️ Удалить
                    </button>
                ` : ''}
            </div>
        </div>
        
        <div style="display: flex; gap: 12px; font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">
            <span>📁 ${task.category || 'general'}</span>
            <span>👥 ${peopleRequired} чел.</span>
            <span>⚡ ${task.difficulty || 'Легкая'}</span>
            <span>🕒 ${task.time_to_complete || '5-10 минут'}</span>
            <span style="color: ${isCompleted ? 'var(--success)' : 'var(--accent)'};">
                ${isCompleted ? '✅ Завершено' : '🟢 Активно'}
            </span>
        </div>
        
        <div style="margin: 10px 0;">
            <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
                <span>Выполнено: ${completedCount}/${peopleRequired}</span>
                <span>${Math.round(progressPercentage)}%</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${progressPercentage}%; background: ${isCompleted ? 'var(--success)' : 'var(--accent)'};"></div>
            </div>
        </div>
        
        <div style="display: flex; gap: 15px; font-size: 11px; color: var(--text-secondary);">
            <span>✅ ${completedCount} выполнено</span>
            <span>❌ ${task.rejected_count || 0} отклонено</span>
            <span>⏳ ${task.pending_count || 0} на проверке</span>
        </div>
        
        ${task.image_url ? `
            <div style="margin-top: 10px;">
                <img src="${task.image_url}" alt="Изображение задания" style="max-width: 200px; border-radius: 8px; border: 1px solid var(--border);">
            </div>
        ` : ''}
        
        <div style="margin-top: 8px; font-size: 11px; color: var(--text-secondary);">
            Создано: ${new Date(task.created_at).toLocaleDateString('ru-RU')}
            ${task.last_completed ? ` • Последнее выполнение: ${new Date(task.last_completed).toLocaleDateString('ru-RU')}` : ''}
        </div>
    `;
    
    return taskElement;
}

function filterAdminTasks() {
    const container = document.getElementById('admin-tasks-container');
    if (!container) return;
    
    const currentTasks = window.currentAdminTasks || [];
    if (currentTasks.length > 0) {
        renderAdminTasks(currentTasks);
    }
}

// Управление админами
async function loadAdminsList() {
    console.log('🔄 Loading admins list...');
    
    if (!currentUser || parseInt(currentUser.id) !== ADMIN_ID) {
        console.log('❌ User is not main admin');
        return;
    }
    
    try {
        const result = await makeRequest(`/admin/admins-list?adminId=${currentUser.id}`);
        
        if (result.success) {
            displayAdminsList(result.admins);
        } else {
            showNotification('Ошибка загрузки списка админов: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('❌ Error loading admins list:', error);
        showNotification('Ошибка загрузки списка админов', 'error');
    }
}

function displayAdminsList(admins) {
    const container = document.getElementById('admins-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!admins || admins.length === 0) {
        container.innerHTML = `
            <div class="no-tasks" style="text-align: center; padding: 30px;">
                <div style="font-size: 48px; margin-bottom: 16px;">👥</div>
                <div>Нет администраторов</div>
                <div style="font-size: 14px; color: var(--text-secondary); margin-top: 8px;">
                    Добавьте первого администратора
                </div>
            </div>
        `;
        return;
    }
    
    admins.forEach(admin => {
        const adminElement = document.createElement('div');
        adminElement.className = 'admin-task-item';
        
        const isMainAdmin = parseInt(admin.user_id) === ADMIN_ID;
        const joinDate = new Date(admin.created_at).toLocaleDateString('ru-RU');
        const fullName = `${admin.first_name} ${admin.last_name || ''}`.trim();
        const displayName = fullName || `Пользователь ${admin.user_id}`;
        
        adminElement.innerHTML = `
            <div class="admin-task-header">
                <div class="admin-task-title">
                    ${displayName}
                    ${isMainAdmin ? ' <span style="color: var(--gold);">(Главный админ)</span>' : ''}
                </div>
                ${!isMainAdmin ? `
                    <div class="admin-task-actions">
                        <button class="admin-task-delete" onclick="removeAdmin(${admin.user_id})">
                            🗑️ Удалить
                        </button>
                    </div>
                ` : ''}
            </div>
            <div class="admin-task-description">
                @${admin.username} • ID: ${admin.user_id} • Добавлен: ${joinDate}
            </div>
            <div style="margin-top: 8px; font-size: 12px; color: ${admin.is_admin ? 'var(--success)' : 'var(--error)'};">
                ${admin.is_admin ? '✅ Права администратора активны' : '❌ Права администратора не активны'}
            </div>
            
            ${!isMainAdmin ? `
                <div style="margin-top: 12px; padding: 10px; background: var(--bg-secondary); border-radius: 8px;">
                    <h5 style="margin-bottom: 8px;">📊 Статистика админа:</h5>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px;">
                        <div>📝 Посты: <strong>${admin.posts_count || 0}</strong></div>
                        <div>📋 Задания: <strong>${admin.tasks_count || 0}</strong></div>
                        <div>✅ Проверки: <strong>${admin.verifications_count || 0}</strong></div>
                        <div>💬 Ответов: <strong>${admin.support_count || 0}</strong></div>
                        <div>💳 Выплат: <strong>${admin.payments_count || 0}</strong></div>
                    </div>
                </div>
                
                <div style="margin-top: 10px;">
                    <h6 style="margin-bottom: 6px;">🔧 Права доступа:</h6>
                    <div style="display: flex; flex-wrap: wrap; gap: 5px;">
                        <label style="font-size: 12px;">
                            <input type="checkbox" ${admin.can_posts ? 'checked' : ''} onchange="updateAdminPermissions(${admin.user_id}, 'posts', this.checked)"> 📝 Посты
                        </label>
                        <label style="font-size: 12px;">
                            <input type="checkbox" ${admin.can_tasks ? 'checked' : ''} onchange="updateAdminPermissions(${admin.user_id}, 'tasks', this.checked)"> 📋 Задания
                        </label>
                        <label style="font-size: 12px;">
                            <input type="checkbox" ${admin.can_verification ? 'checked' : ''} onchange="updateAdminPermissions(${admin.user_id}, 'verification', this.checked)"> ✅ Проверка
                        </label>
                        <label style="font-size: 12px;">
                            <input type="checkbox" ${admin.can_support ? 'checked' : ''} onchange="updateAdminPermissions(${admin.user_id}, 'support', this.checked)"> 💬 Поддержка
                        </label>
                        <label style="font-size: 12px;">
                            <input type="checkbox" ${admin.can_payments ? 'checked' : ''} onchange="updateAdminPermissions(${admin.user_id}, 'payments', this.checked)"> 💳 Оплаты
                        </label>
                    </div>
                </div>
            ` : ''}
        `;
        
        container.appendChild(adminElement);
    });
}

async function addNewAdmin() {
    console.log('🔍 DEBUG addNewAdmin START');
    
    const usernameInput = document.getElementById('new-admin-username');
    const messageDiv = document.getElementById('admin-form-message');
    const submitBtn = document.getElementById('add-admin-btn');
    
    if (!usernameInput || !messageDiv) {
        console.error('❌ Required elements not found');
        showNotification('Ошибка: элементы формы не найдены', 'error');
        return;
    }
    
    let username = usernameInput.value.trim();
    
    if (username.startsWith('@')) {
        username = username.substring(1);
        usernameInput.value = username;
    }
    
    console.log('👤 Processing username:', username);
    
    if (!username) {
        messageDiv.innerHTML = '<span style="color: var(--error);">Введите Telegram username пользователя!</span>';
        return;
    }
    
    if (username.length < 3) {
        messageDiv.innerHTML = '<span style="color: var(--error);">Username должен содержать минимум 3 символа</span>';
        return;
    }
    
    if (!currentUser) {
        messageDiv.innerHTML = '<span style="color: var(--error);">Пользователь не авторизован</span>';
        return;
    }
    
    if (parseInt(currentUser.id) !== ADMIN_ID) {
        messageDiv.innerHTML = '<span style="color: var(--error);">Только главный администратор может добавлять админов!</span>';
        console.log('❌ Not main admin:', { currentUserId: currentUser.id, ADMIN_ID });
        return;
    }
    
    submitBtn.disabled = true;
    submitBtn.textContent = 'Добавляем...';
    messageDiv.innerHTML = '<span style="color: var(--warning);">Добавляем администратора...</span>';
    
    try {
        const requestData = {
            adminId: currentUser.id,
            username: username
        };
        
        console.log('📤 Sending request:', requestData);
        
        const result = await makeRequest('/api/admin/add-admin', {
            method: 'POST',
            body: JSON.stringify(requestData)
        });
        
        console.log('📨 Server response:', result);
        
        if (result.success) {
            messageDiv.innerHTML = `<span style="color: var(--success);">${result.message}</span>`;
            usernameInput.value = '';
            
            setTimeout(() => {
                loadAdminsList();
            }, 1000);
            
            showNotification(result.message, 'success');
            
        } else {
            messageDiv.innerHTML = `<span style="color: var(--error);">Ошибка: ${result.error}</span>`;
            showNotification('Ошибка: ' + result.error, 'error');
        }
        
    } catch (error) {
        console.error('💥 Error adding admin:', error);
        
        let errorMessage = 'Ошибка при добавлении админа';
        if (error.message.includes('404')) {
            errorMessage = 'Ошибка: не найден. Сервер недоступен.';
        } else if (error.message.includes('Failed to fetch')) {
            errorMessage = 'Ошибка сети. Проверьте подключение к интернету.';
        } else {
            errorMessage = error.message;
        }
        
        messageDiv.innerHTML = `<span style="color: var(--error);">${errorMessage}</span>`;
        showNotification(errorMessage, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '➕ Добавить администратора';
        console.log('🔍 DEBUG addNewAdmin END');
    }
}

async function removeAdmin(targetAdminId) {
    console.log('🗑️ Removing admin:', targetAdminId);
    
    if (!currentUser || parseInt(currentUser.id) !== ADMIN_ID) {
        showNotification('Только главный администратор может удалять админов!', 'error');
        return;
    }
    
    if (!confirm('Вы уверены, что хотите удалить этого администратора?')) {
        return;
    }
    
    try {
        const result = await makeRequest('/admin/remove-admin', {
            method: 'POST',
            body: JSON.stringify({
                adminId: currentUser.id,
                targetAdminId: targetAdminId
            })
        });
        
        if (result.success) {
            showNotification(result.message, 'success');
            loadAdminsList();
        } else {
            showNotification('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('❌ Error removing admin:', error);
        showNotification('Ошибка удаления админа: ' + error.message, 'error');
    }
}

async function updateAdminPermissions(adminId, permission, enabled) {
    try {
        const result = await makeRequest('/admin/update-permissions', {
            method: 'POST',
            body: JSON.stringify({
                adminId: currentUser.id,
                targetAdminId: adminId,
                permission: permission,
                enabled: enabled
            })
        });
        
        if (result.success) {
            showNotification('Права доступа обновлены', 'success');
        } else {
            showNotification('Ошибка обновления прав: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Update permissions error:', error);
        showNotification('Ошибка обновления прав доступа', 'error');
    }
}

// Управление промокодами
async function loadPromocodesList() {
    console.log('🔄 Loading promocodes list...');
    
    if (!currentUser || parseInt(currentUser.id) !== ADMIN_ID) {
        console.log('❌ User is not main admin, cannot load promocodes');
        showNotification('Только главный администратор может управлять промокодами!', 'error');
        return;
    }
    
    try {
        const result = await makeRequest(`/api/admin/promocodes/list?adminId=${currentUser.id}`);
        
        if (result.success) {
            displayPromocodesList(result.promocodes);
            console.log(`✅ Loaded ${result.promocodes?.length || 0} promocodes`);
        } else {
            console.error('❌ Error loading promocodes:', result.error);
            showNotification('Ошибка загрузки промокодов: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('❌ Load promocodes error:', error);
        showNotification('Ошибка загрузки промокодов: ' + error.message, 'error');
    }
}

function displayPromocodesList(promocodes) {
    const container = document.getElementById('promocodes-list');
    if (!container) {
        console.error('❌ Promocodes list container not found');
        return;
    }
    
    container.innerHTML = '';
    
    console.log(`🎨 Displaying ${promocodes.length} promocodes`);
    
    promocodes.forEach(promo => {
        const promoElement = createPromocodeElement(promo);
        container.appendChild(promoElement);
    });
}

function createPromocodeElement(promo) {
    const promoElement = document.createElement('div');
    promoElement.className = 'admin-task-item';
    
    const usedCount = promo.used_count || 0;
    const isExpired = promo.expires_at && new Date(promo.expires_at) < new Date();
    const isFullyUsed = usedCount >= promo.max_uses;
    const status = isExpired ? 'expired' : (isFullyUsed ? 'used' : 'active');
    
    const statusColors = {
        active: 'var(--success)',
        used: 'var(--warning)',
        expired: 'var(--error)'
    };
    
    const statusTexts = {
        active: '🟢 Активен',
        used: '🟡 Использован',
        expired: '🔴 Просрочен'
    };
    
    const usagePercentage = Math.round((usedCount / promo.max_uses) * 100);
    
    promoElement.innerHTML = `
        <div class="admin-task-header">
            <div class="admin-task-title">
                <span style="font-size: 20px; font-weight: 800; color: var(--gold); letter-spacing: 1px;">${promo.code}</span>
                <span style="color: ${statusColors[status]}; font-size: 12px; margin-left: 10px; font-weight: 600;">
                    ${statusTexts[status]}
                </span>
            </div>
            <div class="admin-task-actions">
                <button class="admin-task-delete" onclick="deactivatePromoCode('${promo.code}')" 
                        style="background: var(--error); color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
                    🗑️ Удалить
                </button>
            </div>
        </div>
        
        <div class="admin-task-description">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                <div>
                    <div style="font-size: 12px; color: var(--text-secondary);">🎁 Награда</div>
                    <div style="font-size: 18px; font-weight: 700; color: var(--gold);">${promo.reward} ⭐</div>
                </div>
                <div>
                    <div style="font-size: 12px; color: var(--text-secondary);">👥 Использовано</div>
                    <div style="font-size: 16px; font-weight: 600;">${usedCount}/${promo.max_uses}</div>
                </div>
            </div>
            
            <div style="margin: 10px 0;">
                <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
                    <span>Прогресс использования</span>
                    <span>${usagePercentage}%</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${usagePercentage}%; 
                         background: ${status === 'active' ? 'var(--success)' : status === 'used' ? 'var(--warning)' : 'var(--error)'};">
                    </div>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 12px; color: var(--text-secondary);">
                <div>
                    <div>📅 Создан</div>
                    <div style="font-weight: 600;">${new Date(promo.created_at).toLocaleDateString('ru-RU')}</div>
                </div>
                <div>
                    <div>⏰ ${promo.expires_at ? 'Истекает' : 'Срок действия'}</div>
                    <div style="font-weight: 600;">
                        ${promo.expires_at ? 
                          new Date(promo.expires_at).toLocaleDateString('ru-RU') : 
                          'Бессрочный'}
                    </div>
                </div>
            </div>
            
            ${usedCount > 0 ? `
                <div style="margin-top: 10px; padding: 8px; background: var(--bg-secondary); border-radius: 6px;">
                    <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">
                        📊 Статистика активаций:
                    </div>
                    <div style="font-size: 12px;">
                        Всего выдано: <strong>${usedCount * promo.reward} ⭐</strong>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
    
    return promoElement;
}

async function createPromoCode() {
    try {
        console.log('🎫 START: createPromoCode');
        
        if (!currentUser) {
            throw new Error('Пользователь не авторизован');
        }
        
        if (parseInt(currentUser.id) !== ADMIN_ID) {
            throw new Error('Только главный администратор может создавать промокоды!');
        }
        
        const codeInput = document.getElementById('promocode-code');
        const maxUsesInput = document.getElementById('promocode-max-uses');
        const rewardInput = document.getElementById('promocode-reward');
        const expiresInput = document.getElementById('promocode-expires');
        const messageDiv = document.getElementById('promocode-form-message');
        const submitBtn = document.getElementById('create-promocode-btn');
        
        if (!codeInput || !maxUsesInput || !rewardInput || !messageDiv || !submitBtn) {
            console.error('❌ Missing form elements:', {
                codeInput: !!codeInput,
                maxUsesInput: !!maxUsesInput,
                rewardInput: !!rewardInput,
                messageDiv: !!messageDiv,
                submitBtn: !!submitBtn
            });
            throw new Error('Элементы формы не найдены. Обновите страницу.');
        }
        
        const code = codeInput?.value?.trim().toUpperCase() || '';
        const maxUses = maxUsesInput?.value ? parseInt(maxUsesInput.value) : 0;
        const reward = rewardInput?.value ? parseFloat(rewardInput.value) : 0;
        const expiresAt = expiresInput?.value ? new Date(expiresInput.value).toISOString() : null;
        
        console.log('📊 Form data:', { code, maxUses, reward, expiresAt });
        
        if (!code) {
            throw new Error('Введите код промокода!');
        }
        
        if (!/^[A-Z0-9]+$/.test(code)) {
            throw new Error('Код должен содержать только латинские буквы и цифры!');
        }
        
        if (code.length < 3 || code.length > 20) {
            throw new Error('Длина кода должна быть от 3 до 20 символов!');
        }
        
        if (!maxUses || maxUses < 1 || maxUses > 10000) {
            throw new Error('Введите корректное количество активаций (1-10000)!');
        }
        
        if (!reward || reward < 1 || reward > 100000) {
            throw new Error('Введите корректную награду (1-100000 звезд)!');
        }
        
        submitBtn.disabled = true;
        submitBtn.textContent = 'Создаем...';
        showMessage('⏳ Создаем промокод...', 'loading', messageDiv);
        
        console.log('📤 Sending request to server...');
        
        const result = await makeRequest('/api/admin/promocodes/create', {
            method: 'POST',
            body: JSON.stringify({
                adminId: currentUser.id,
                code: code,
                maxUses: maxUses,
                reward: reward,
                expiresAt: expiresAt
            })
        });
        
        console.log('📨 Server response:', result);
        
        if (result.success) {
            showMessage(`✅ ${result.message}`, 'success', messageDiv);
            
            codeInput.value = '';
            maxUsesInput.value = '10';
            rewardInput.value = '50';
            expiresInput.value = '';
            
            loadPromocodesList();
            
        } else {
            throw new Error(result.error || 'Неизвестная ошибка сервера');
        }
        
    } catch (error) {
        console.error('❌ createPromoCode error:', error);
        const messageDiv = document.getElementById('promocode-form-message');
        showMessage(`❌ Ошибка: ${error.message}`, 'error', messageDiv);
        showNotification(`Ошибка создания промокода: ${error.message}`, 'error');
    } finally {
        const submitBtn = document.getElementById('create-promocode-btn');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '🎫 Создать промокод';
        }
    }
}

async function deactivatePromoCode(code) {
    if (!confirm(`Вы уверены, что хотите удалить промокод "${code}"?\n\nЭто действие нельзя отменить.`)) {
        return;
    }
    
    if (!currentUser || parseInt(currentUser.id) !== ADMIN_ID) {
        showNotification('Только главный администратор может удалять промокоды!', 'error');
        return;
    }
    
    try {
        const result = await makeRequest('/api/admin/promocodes/deactivate', {
            method: 'POST',
            body: JSON.stringify({
                adminId: currentUser.id,
                code: code
            })
        });
        
        if (result.success) {
            showNotification(`✅ Промокод "${code}" успешно удален!`, 'success');
            loadPromocodesList();
        } else {
            showNotification('❌ Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('❌ Deactivate promocode error:', error);
        showNotification('❌ Ошибка удаления промокода: ' + error.message, 'error');
    }
}

// Управление выплатами
async function loadWithdrawalRequests() {
    console.log('🔄 Loading withdrawal requests...');
    
    if (!currentUser) {
        console.log('❌ No current user');
        showNotification('Пользователь не авторизован', 'error');
        return;
    }
    
    try {
        const rightsResult = await makeRequest(`/admin/debug-rights?userId=${currentUser.id}`);
        console.log('🔍 Admin rights check:', rightsResult);
        
        if (!rightsResult.isAdmin) {
            showNotification('❌ У вас нет прав администратора!', 'error');
            return;
        }
        
        const result = await makeRequest(`/admin/withdrawal-requests?adminId=${currentUser.id}`);
        console.log('📨 Withdrawal requests response:', result);
        
        if (result.success) {
            displayWithdrawalRequests(result.requests);
        } else {
            console.error('❌ Failed to load requests:', result.error);
            showNotification('Ошибка загрузки заявок: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('❌ Load withdrawal requests error:', error);
        showNotification('Ошибка загрузки заявок: ' + error.message, 'error');
    }
}

function displayWithdrawalRequests(requests) {
    const container = document.getElementById('withdrawal-requests-list');
    if (!container) {
        console.error('❌ Container not found');
        return;
    }
    
    container.innerHTML = '';
    
    const activeCount = document.getElementById('active-withdrawals-count');
    const totalCount = document.getElementById('total-withdrawals-count');
    
    if (activeCount) activeCount.textContent = requests.length;
    if (totalCount) totalCount.textContent = requests.length;
    
    if (!requests || requests.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                <div style="font-size: 48px; margin-bottom: 16px;">💫</div>
                <div>Нет активных запросов на вывод</div>
                <div style="font-size: 12px; margin-top: 8px;">Новые запросы появятся здесь</div>
            </div>
        `;
        return;
    }
    
    console.log(`✅ Отображаем ${requests.length} заявок`);
    
    requests.forEach(request => {
        const requestElement = document.createElement('div');
        requestElement.className = 'admin-task-item';
        requestElement.style.marginBottom = '15px';
        
        const userName = request.first_name || request.username || `User_${request.user_id}`;
        const requestDate = new Date(request.created_at).toLocaleString('ru-RU');
        
        requestElement.innerHTML = `
            <div class="admin-task-header">
                <div class="admin-task-title">
                    ${userName}
                    ${request.username ? ` (@${request.username})` : ''}
                </div>
                <div class="admin-task-price" style="font-size: 20px; color: var(--gold);">
                    ${request.amount} ⭐
                </div>
            </div>
            <div class="admin-task-description">
                <div>ID пользователя: ${request.user_id}</div>
                <div>Запрос создан: ${requestDate}</div>
            </div>
            <div class="admin-task-actions" style="margin-top: 10px; display: flex; gap: 10px;">
                <button class="admin-task-approve" onclick="completeWithdrawal(${request.id})" 
                        style="background: var(--success); color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; flex: 1;">
                    ✅ Перечислил средства
                </button>
                <button class="admin-task-cancel" onclick="cancelWithdrawal(${request.id})" 
                        style="background: var(--error); color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; flex: 1;">
                    ❌ Отменить выплату
                </button>
            </div>
        `;
        
        container.appendChild(requestElement);
    });
}

async function completeWithdrawal(requestId) {
    console.log('🔧 completeWithdrawal called:', {
        requestId,
        currentUser: currentUser,
        currentUserId: currentUser?.id
    });
    
    if (!confirm('Вы уверены, что перечислили средства пользователю?')) {
        return;
    }
    
    try {
        console.log('📤 Sending complete request...');
        const result = await makeRequest(`/admin/withdrawal-requests/${requestId}/complete`, {
            method: 'POST',
            body: JSON.stringify({
                adminId: currentUser.id
            })
        });
        
        console.log('📨 Complete response:', result);
        
        if (result.success) {
            showNotification('✅ Выплата подтверждена!', 'success');
            loadWithdrawalRequests();
        } else {
            showNotification('❌ Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('❌ Complete withdrawal error:', error);
        showNotification('❌ Ошибка подтверждения выплаты: ' + error.message, 'error');
    }
}

async function cancelWithdrawal(requestId) {
    if (!confirm('Вы уверены, что хотите отменить эту выплату?\n\nСредства будут возвращены на баланс пользователя.')) {
        return;
    }
    
    try {
        console.log('🔄 Cancelling withdrawal:', requestId);
        
        const result = await makeRequest(`/api/admin/withdrawal-requests/${requestId}/cancel`, {
            method: 'POST',
            body: JSON.stringify({
                adminId: currentUser.id
            })
        });
        
        console.log('📨 Cancel response:', result);
        
        if (result.success) {
            showNotification(`✅ ${result.message}`, 'success');
            loadWithdrawalRequests();
        } else {
            showNotification('❌ Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('❌ Cancel withdrawal error:', error);
        showNotification('❌ Ошибка отмены выплаты: ' + error.message, 'error');
    }
}

// Управление постами
async function addNewPost() {
    const title = document.getElementById('admin-post-title').value;
    const content = document.getElementById('admin-post-content').value;
    
    if (!title || !content) {
        showNotification('Заполните заголовок и содержание поста!', 'error');
        return;
    }
    
    if (!currentUser.isAdmin || parseInt(currentUser.id) !== ADMIN_ID) {
        showNotification('Только администратор может публиковать посты!', 'error');
        return;
    }
    
    try {
        const result = await makeRequest('/posts', {
            method: 'POST',
            body: JSON.stringify({
                title: title,
                content: content,
                author: currentUser.firstName,
                authorId: currentUser.id
            })
        });

        if (result.success) {
            showNotification('Пост успешно опубликован!', 'success');
            document.getElementById('admin-post-title').value = '';
            document.getElementById('admin-post-content').value = '';
            loadMainPagePosts();
        } else {
            showNotification('Ошибка: ' + result.error, 'error');
        }
        
    } catch (error) {
        console.error('Error adding post:', error);
        showNotification('Ошибка соединения: ' + error.message, 'error');
    }
}

async function deletePost(postId) {
    if (!confirm('Удалить этот пост?')) return;
    
    if (!currentUser.isAdmin || parseInt(currentUser.id) !== ADMIN_ID) {
        showNotification('Только администратор может удалять посты!', 'error');
        return;
    }
    
    try {
        const result = await makeRequest(`/posts/${postId}`, {
            method: 'DELETE',
            body: JSON.stringify({ authorId: currentUser.id })
        });

        if (result.success) {
            showNotification('Пост успешно удален!', 'success');
            loadMainPagePosts();
        } else {
            showNotification('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error deleting post:', error);
        showNotification('Ошибка соединения: ' + error.message, 'error');
    }
}

// Управление заданиями
async function addTaskWithImage() {
    console.log('🎯 Starting add task with image...');
    
    try {
        const taskData = {
            title: document.getElementById('admin-task-title').value.trim(),
            description: document.getElementById('admin-task-description').value.trim(),
            price: document.getElementById('admin-task-price').value,
            category: document.getElementById('admin-task-category').value,
            time_to_complete: document.getElementById('admin-task-time').value || '5-10 минут',
            difficulty: document.getElementById('admin-task-difficulty').value,
            people_required: document.getElementById('admin-task-people').value || 1,
            task_url: document.getElementById('admin-task-url').value || '',
            created_by: currentUser.id
        };

        console.log('📋 Form data collected:', taskData);

        if (!taskData.title.trim()) {
            showNotification('Введите название задания!', 'error');
            return;
        }
        if (!taskData.description.trim()) {
            showNotification('Введите описание задания!', 'error');
            return;
        }
        if (!taskData.price) {
            showNotification('Введите цену задания!', 'error');
            return;
        }

        const price = parseFloat(taskData.price);
        if (isNaN(price) || price <= 0) {
            showNotification('Цена должна быть положительным числом!', 'error');
            return;
        }

        const formData = new FormData();
        
        Object.keys(taskData).forEach(key => {
            formData.append(key, taskData[key]);
        });
        
        if (currentTaskImage) {
            formData.append('image', currentTaskImage);
            console.log('📸 Adding image to form data:', currentTaskImage.name);
        } else {
            console.log('ℹ️ No image selected');
        }

        console.log('📤 Sending task with image...');

        const response = await fetch('/api/tasks-with-image', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        console.log('📨 Server response:', result);

        if (result.success) {
            showNotification('✅ Задание с фото успешно создано!', 'success');
            
            clearTaskForm();
            clearTaskImage();
            
            setTimeout(() => {
                loadAdminTasks();
                loadTasks();
            }, 1000);
            
        } else {
            throw new Error(result.error || 'Unknown server error');
        }

    } catch (error) {
        console.error('💥 Error in addTaskWithImage:', error);
        showNotification(`❌ Ошибка создания задания: ${error.message}`, 'error');
    }
}

async function deleteTask(taskId) {
    if (!confirm('Удалить это задание?')) return;
    
    if (!currentUser || !currentUser.isAdmin || parseInt(currentUser.id) !== ADMIN_ID) {
        showNotification('Только администратор может удалять задания!', 'error');
        return;
    }
    
    try {
        const result = await makeRequest(`/tasks/${taskId}`, {
            method: 'DELETE',
            body: JSON.stringify({ adminId: currentUser.id })
        });

        if (result.success) {
            showNotification('Задание успешно удалено!', 'success');
            loadAdminTasks();
            loadTasks();
        } else {
            showNotification('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error deleting task:', error);
        showNotification('Ошибка удаления задания: ' + error.message, 'error');
    }
}

// Проверка заданий
async function loadTaskVerifications() {
    if (!currentUser) return;

    try {
        console.log('🔄 Loading task verifications...');
        const result = await makeRequest(`/api/admin/task-verifications?adminId=${currentUser.id}`);
        
        console.log('📨 Verifications response:', result);
        
        if (result.success) {
            console.log(`✅ Loaded ${result.verifications?.length || 0} verifications`);
            displayTaskVerifications(result.verifications);
        } else {
            console.error('❌ Failed to load verifications:', result.error);
        }
    } catch (error) {
        console.error('❌ Error loading task verifications:', error);
    }
}

function displayTaskVerifications(verifications) {
    const container = document.getElementById('admin-verification-list');
    if (!container) return;

    container.innerHTML = '';

    if (!verifications || verifications.length === 0) {
        container.innerHTML = `
            <div class="no-tasks" style="text-align: center; padding: 40px 20px;">
                <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
                <div>Нет заданий на проверке</div>
                <div style="font-size: 14px; color: var(--text-secondary); margin-top: 8px;">
                    Новые задания появятся здесь после отправки пользователями
                </div>
            </div>
        `;
        return;
    }

    verifications.forEach(verification => {
        const verificationElement = document.createElement('div');
        verificationElement.className = 'verification-item';
        verificationElement.style.cssText = `
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 12px;
            cursor: pointer;
            transition: all 0.3s ease;
        `;
        verificationElement.onmouseover = function() {
            this.style.transform = 'translateY(-2px)';
            this.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
        };
        verificationElement.onmouseout = function() {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = 'none';
        };

        verificationElement.onclick = () => openVerificationModal(verification);

        const userAvatar = verification.user_name ? verification.user_name.charAt(0).toUpperCase() : 'U';
        const submissionTime = formatPostDate(verification.submitted_at);

        verificationElement.innerHTML = `
            <div class="verification-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div class="verification-avatar" style="width: 40px; height: 40px; border-radius: 50%; background: var(--purple-gradient); display: flex; align-items: center; justify-content: center; color: white; font-weight: 600;">
                        ${userAvatar}
                    </div>
                    <div class="verification-user-info">
                        <div class="verification-user-name" style="font-weight: 600; margin-bottom: 4px;">
                            ${verification.user_name}
                            ${verification.username ? `(@${verification.username})` : ''}
                        </div>
                        <div class="verification-task-title" style="color: var(--text-secondary); font-size: 14px;">
                            ${verification.task_title}
                        </div>
                    </div>
                </div>
                <div class="verification-price" style="font-size: 18px; font-weight: 700; color: var(--gold);">
                    ${verification.task_price} ⭐
                </div>
            </div>
            <div class="verification-time" style="color: var(--text-secondary); font-size: 12px;">
                Отправлено: ${submissionTime}
            </div>
            
            <div style="margin-top: 10px; padding: 8px; background: rgba(59, 130, 246, 0.1); border-radius: 6px; border-left: 3px solid var(--accent);">
                <div style="font-size: 12px; color: var(--accent); font-weight: 600;">
                    📸 Нажмите для просмотра скриншота и проверки
                </div>
            </div>
        `;

        container.appendChild(verificationElement);
    });
}

function openVerificationModal(verification) {
    console.log('📖 Opening verification modal:', verification);
    
    if (!verification) {
        console.error('❌ No verification data provided');
        showNotification('Ошибка: данные проверки не получены', 'error');
        return;
    }
    
    currentVerificationId = verification.id;

    const userAvatar = document.getElementById('verification-user-avatar');
    const userName = document.getElementById('verification-user-name');
    const taskTitle = document.getElementById('verification-task-title');
    const taskPrice = document.getElementById('verification-task-price');
    const screenshot = document.getElementById('verification-screenshot');
    
    if (userAvatar) {
        userAvatar.textContent = verification.user_name ? 
            verification.user_name.charAt(0).toUpperCase() : 'U';
    }
    
    if (userName) {
        userName.textContent = verification.user_name || 'Пользователь';
    }
    
    if (taskTitle) {
        taskTitle.textContent = verification.task_title || 'Задание';
    }
    
    if (taskPrice) {
        taskPrice.textContent = `${verification.task_price || 0} ⭐`;
    }
    
    if (screenshot) {
        if (verification.screenshot_url) {
            screenshot.src = verification.screenshot_url;
            screenshot.style.display = 'block';
            screenshot.onerror = function() {
                console.error('❌ Failed to load screenshot');
                this.style.display = 'none';
                showScreenshotErrorWarning();
            };
        } else {
            screenshot.style.display = 'none';
            showScreenshotErrorWarning();
        }
    }

    const modal = document.getElementById('verification-modal');
    if (modal) {
        modal.classList.add('active');
        console.log('✅ Verification modal opened');
    } else {
        console.error('❌ Verification modal not found');
        showNotification('Ошибка: модальное окно не найдено', 'error');
    }
}

async function approveVerification() {
    if (!currentVerificationId) {
        showNotification('❌ ID верификации не найден', 'error');
        return;
    }

    if (!currentUser) {
        showNotification('❌ Пользователь не авторизован', 'error');
        return;
    }

    try {
        console.log(`🔄 Начинаем одобрение верификации:`, {
            verificationId: currentVerificationId,
            adminId: currentUser.id
        });

        const approveBtn = document.querySelector('.btn-success');
        if (approveBtn) {
            approveBtn.disabled = true;
            approveBtn.textContent = 'Одобряем...';
        }

        const result = await makeRequest(`/api/admin/task-verifications/${currentVerificationId}/approve`, {
            method: 'POST',
            body: JSON.stringify({
                adminId: currentUser.id,
                forceApprove: true
            })
        });

        console.log('📨 Ответ сервера при одобрении:', result);

        if (result.success) {
            let message = `✅ Задание одобрено! Пользователь получил ${result.amountAdded || result.task_price}⭐`;
            
            if (result.referralBonus) {
                message += `\n\n👥 Реферальный бонус: ${result.referralBonus.referrerName} получил ${result.referralBonus.bonusAmount}⭐ (10%)`;
                showReferralBonusAnimation(result.referralBonus.referrerName, result.referralBonus.bonusAmount);
            }
            
            if (result.taskRemoved || result.taskCompleted) {
                message += "\n\n🎯 Задание автоматически удалено - достигнут лимит исполнителей!";
            }
            
            showNotification(message, 'success');
            
            closeModal('verification-modal');
            
            setTimeout(() => {
                loadTaskVerifications();
                loadAdminTasks();
                updateUserData();
                console.log('✅ Интерфейс успешно обновлен после одобрения задания');
            }, 500);
            
        } else {
            if (result.error && (result.error.includes('скриншот') || result.error.includes('изображение'))) {
                console.log('⚠️ Проблема со скриншотом, пробуем принудительное одобрение...');
                await forceApproveVerification();
            } else {
                throw new Error(result.error || 'Неизвестная ошибка сервера');
            }
        }

    } catch (error) {
        console.error('❌ Сетевая ошибка при одобрении:', error);
        console.log('🚨 Аварийный режим: пробуем принудительное одобрение...');
        await forceApproveVerification();
    }
}

async function forceApproveVerification() {
    try {
        console.log('🔧 Принудительное одобрение верификации:', currentVerificationId);
        
        const result = await makeRequest(`/api/admin/task-verifications/${currentVerificationId}/force-approve`, {
            method: 'POST',
            body: JSON.stringify({
                adminId: currentUser.id,
                reason: 'Автоматическое одобрение при ошибке загрузки скриншота'
            })
        });

        if (result.success) {
            showNotification('✅ Задание одобрено (автоматический режим)!', 'success');
            
            closeModal('verification-modal');
            
            setTimeout(() => {
                loadTaskVerifications();
                loadAdminTasks();
                updateUserData();
            }, 500);
            
        } else {
            throw new Error('Не удалось выполнить принудительное одобрение: ' + result.error);
        }
        
    } catch (forceError) {
        console.error('❌ Ошибка принудительного одобрения:', forceError);
        showNotification('❌ Критическая ошибка: ' + forceError.message, 'error');
        
        const approveBtn = document.querySelector('.btn-success');
        if (approveBtn) {
            approveBtn.disabled = false;
            approveBtn.textContent = '✅ Одобрить';
        }
    }
}

async function rejectVerification() {
    if (!currentVerificationId) return;

    try {
        const result = await makeRequest(`/api/admin/task-verifications/${currentVerificationId}/reject`, {
            method: 'POST',
            body: JSON.stringify({
                adminId: currentUser.id
            })
        });

        if (result.success) {
            showNotification('Задание отклонено', 'success');
            closeModal('verification-modal');
            loadTaskVerifications();
            
            setTimeout(() => {
                loadTasks();
                loadUserTasks();
            }, 500);
            
        } else {
            showNotification('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error rejecting verification:', error);
        showNotification('Ошибка отклонения задания', 'error');
    }
}

async function deleteVerification() {
    if (!currentVerificationId) {
        showNotification('❌ ID проверки не найден', 'error');
        return;
    }

    if (!confirm('Вы уверены, что хотите удалить эту проверку?\n\nЗадание вернется пользователю для повторной отправки скриншота.')) {
        return;
    }

    try {
        console.log(`🗑️ Deleting verification:`, {
            verificationId: currentVerificationId,
            adminId: currentUser.id
        });

        const result = await makeRequest(`/api/admin/task-verifications/${currentVerificationId}/delete`, {
            method: 'POST',
            body: JSON.stringify({
                adminId: currentUser.id
            })
        });

        console.log('📨 Delete verification response:', result);

        if (result.success) {
            showNotification('✅ Проверка удалена! Задание возвращено пользователю.', 'success');
            
            closeModal('verification-modal');
            
            setTimeout(() => {
                loadTaskVerifications();
                console.log('✅ Списки обновлены после удаления проверки');
            }, 500);
            
        } else {
            throw new Error(result.error || 'Неизвестная ошибка сервера');
        }

    } catch (error) {
        console.error('❌ Delete verification error:', error);
        
        let errorMessage = 'Ошибка при удалении проверки';
        if (error.message.includes('Failed to fetch')) {
            errorMessage = '❌ Проблема с соединением. Проверьте интернет.';
        } else if (error.message.includes('404')) {
            errorMessage = '❌ Проверка не найдена.';
        } else if (error.message.includes('403')) {
            errorMessage = '❌ Доступ запрещен.';
        }
        
        showNotification(errorMessage, 'error');
    }
}

// Вспомогательные функции
function showScreenshotErrorWarning() {
    const modalBody = document.querySelector('.verification-modal-content .modal-body');
    if (!modalBody) return;
    
    const existingWarning = document.getElementById('screenshot-warning');
    if (existingWarning) {
        existingWarning.remove();
    }
    
    const warningHTML = `
        <div id="screenshot-warning" style="
            background: rgba(255, 152, 0, 0.1);
            border: 1px solid #ff9800;
            border-radius: 8px;
            padding: 12px;
            margin: 10px 0;
            text-align: center;
        ">
            <div style="color: #ff9800; font-weight: 600; margin-bottom: 5px;">
                ⚠️ Скриншот не загружен
            </div>
            <div style="font-size: 12px; color: var(--text-secondary);">
                Вы все равно можете одобрить задание, нажав кнопку ниже
            </div>
        </div>
    `;
    
    const actionButtons = modalBody.querySelector('.verification-modal-actions');
    if (actionButtons) {
        actionButtons.insertAdjacentHTML('beforebegin', warningHTML);
    }
}

function showReferralBonusAnimation(referrerName, bonusAmount) {
    const animation = document.createElement('div');
    animation.style.cssText = `
        position: fixed;
        top: 20%;
        left: 50%;
        transform: translateX(-50%);
        background: var(--success);
        color: white;
        padding: 20px 30px;
        border-radius: 15px;
        text-align: center;
        z-index: 10001;
        box-shadow: 0 10px 25px rgba(34, 197, 94, 0.3);
        border: 2px solid rgba(255, 255, 255, 0.3);
        animation: referralBonusSlide 3s ease-in-out;
        max-width: 300px;
        width: 90%;
    `;
    
    animation.innerHTML = `
        <div style="font-size: 32px; margin-bottom: 10px;">👥</div>
        <div style="font-size: 18px; font-weight: 700; margin-bottom: 8px;">
            Реферальный бонус!
        </div>
        <div style="font-size: 14px; margin-bottom: 5px;">
            ${referrerName}
        </div>
        <div style="font-size: 20px; font-weight: 800; color: var(--gold);">
            +${bonusAmount} ⭐
        </div>
        <div style="font-size: 12px; opacity: 0.9; margin-top: 5px;">
            (10% от заработка реферала)
        </div>
    `;
    
    document.body.appendChild(animation);
    
    setTimeout(() => {
        animation.remove();
    }, 4000);
}

// Инициализация поиска при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    initAdminTaskSearch();
});

// 🔧 ЭКСПОРТ ФУНКЦИЙ
window.searchAdminTasks = searchAdminTasks;
window.clearAdminTaskSearch = clearAdminTaskSearch;
window.initAdminTaskSearch = initAdminTaskSearch;
window.loadAdminTasks = loadAdminTasks;
window.showAdminAdminsSection = showAdminAdminsSection;
window.loadAdminsList = loadAdminsList;
window.addNewAdmin = addNewAdmin;
window.removeAdmin = removeAdmin;
window.updateAdminPermissions = updateAdminPermissions;
window.loadPromocodesList = loadPromocodesList;
window.createPromoCode = createPromoCode;
window.deactivatePromoCode = deactivatePromoCode;
window.loadWithdrawalRequests = loadWithdrawalRequests;
window.completeWithdrawal = completeWithdrawal;
window.cancelWithdrawal = cancelWithdrawal;
window.addNewPost = addNewPost;
window.deletePost = deletePost;
window.addTaskWithImage = addTaskWithImage;
window.deleteTask = deleteTask;
window.loadTaskVerifications = loadTaskVerifications;
window.openVerificationModal = openVerificationModal;
window.approveVerification = approveVerification;
window.rejectVerification = rejectVerification;
window.deleteVerification = deleteVerification;