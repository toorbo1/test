// 🔧 ФУНКЦИИ ДЛЯ РАБОТЫ С ЗАДАНИЯМИ

// 🔧 ФУНКЦИЯ ФИЛЬТРАЦИИ ЗАДАНИЙ ПО КАТЕГОРИЯМ
function filterTasks(category) {
    console.log('🎯 Filtering tasks by category:', category);
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    const searchText = document.getElementById('task-search').value.trim();
    loadTasks(searchText, category);
}

async function loadTasks(search = '', category = 'all') {
    try {
        console.log('🎯 START loadTasks with filter:', { 
            search, 
            category, 
            userId: currentUser?.id,
            hasUser: !!currentUser
        });

        if (!currentUser) {
            console.log('❌ No current user, aborting loadTasks');
            showNotification('Пользователь не авторизован', 'error');
            return;
        }

        const newTasksContainer = document.getElementById('new-tasks');
        if (!newTasksContainer) {
            console.log('❌ new-tasks container not found');
            return;
        }

        newTasksContainer.innerHTML = `
            <div class="no-tasks" style="min-height: 200px; display: flex; flex-direction: column; justify-content: center; align-items: center;">
                <div class="loading-spinner">⏳</div>
                <div style="margin-top: 16px;">Загружаем задания...</div>
                <div style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">
                    ID: ${currentUser.id}
                </div>
            </div>
        `;

        const params = new URLSearchParams();
        params.append('userId', currentUser.id);
        if (search) params.append('search', search);
        if (category && category !== 'all') params.append('category', category);
        
        const url = `/api/tasks?${params.toString()}`;
        console.log('📡 Request URL:', url);

        const response = await fetch(API_BASE_URL + url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log('📨 Server response:', result);

        if (result.success) {
            allTasks = result.tasks || [];
            console.log(`✅ Loaded ${allTasks.length} tasks:`, allTasks.map(t => ({id: t.id, title: t.title})));
            displayTasks(allTasks, 'new');
        } else {
            throw new Error(result.error || 'Unknown server error');
        }

    } catch (error) {
        console.error('💥 loadTasks error:', error);
        
        const newTasksContainer = document.getElementById('new-tasks');
        if (newTasksContainer) {
            newTasksContainer.innerHTML = `
                <div class="no-tasks" style="min-height: 200px; display: flex; flex-direction: column; justify-content: center; align-items: center;">
                    <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
                    <div>Ошибка загрузки заданий</div>
                    <div style="font-size: 12px; color: var(--text-secondary); margin: 8px 0;">
                        ${error.message}
                    </div>
                    <button class="btn btn-primary" onclick="loadTasks()" style="margin-top: 16px;">
                        Попробовать снова
                    </button>
                </div>
            `;
        }
        
        showNotification(`Ошибка загрузки заданий: ${error.message}`, 'error');
    }
}

function displayTasks(tasks, category) {
    console.log(`🎯 START displayTasks: ${tasks?.length} tasks for ${category}`);
    
    const container = document.getElementById(category + '-tasks');
    if (!container) {
        console.error('❌ Container not found:', category + '-tasks');
        return;
    }

    console.log('📦 Container found, clearing...');
    container.innerHTML = '';

    if (!tasks || tasks.length === 0) {
        console.log('📭 No tasks to display');
        container.innerHTML = `
            <div class="no-tasks" style="min-height: 200px; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 20px; text-align: center;">
                <div style="font-size: 48px; margin-bottom: 16px;">📝</div>
                <div style="font-size: 18px; margin-bottom: 8px;">Заданий пока нет</div>
                <div style="font-size: 14px; color: var(--text-secondary);">
                    Новые задания появятся позже<br>
                    <small>Следите за обновлениями</small>
                </div>
            </div>
        `;
        return;
    }

    console.log(`🎨 Rendering ${tasks.length} tasks...`);
    
    tasks.forEach((task, index) => {
        console.log(`📋 Task ${index}:`, task);
        const taskElement = createTaskCardWithImage(task, category, index);
        container.appendChild(taskElement);
    });
    
    console.log('✅ Tasks displayed successfully');
}

// 🔧 ФУНКЦИЯ СОЗДАНИЯ ЭЛЕМЕНТА ЗАДАНИЯ С ИЗОБРАЖЕНИЕМ
function createTaskCardWithImage(task, category, index) {
    const taskElement = document.createElement('div');
    taskElement.className = 'task-card task-card-with-image';
    if (category === 'rejected') {
        taskElement.classList.add('rejected');
    }
    taskElement.style.animationDelay = `${index * 0.1}s`;
    
    taskElement.setAttribute('data-task-id', task.id);
    taskElement.setAttribute('data-task-title', task.title);
    
    console.log(`🎨 Creating task card: ${task.id} - "${task.title}"`);
    
    const hasImage = task.image_url && task.image_url !== '';
    const peopleRequired = task.people_required || 1;
    const completedCount = task.completed_count || 0;
    const availableTasks = Math.max(0, peopleRequired - completedCount);
    
    let imageHtml = '';
    if (hasImage) {
        imageHtml = `
            <div class="task-image-container">
                <img src="${task.image_url}" alt="${escapeHtml(task.title)}" 
                     class="task-image"
                     onerror="this.onerror=null; this.style.display='none';">
                ${availableTasks > 0 && category === 'new' ? `<div class="task-badge">${availableTasks} осталось</div>` : ''}
            </div>
        `;
    } else {
        imageHtml = `
            ${availableTasks > 0 && category === 'new' ? `<div class="task-availability">${availableTasks} осталось</div>` : ''}
        `;
    }
    
    let buttonHtml = '';
    switch(category) {
        case 'new':
            buttonHtml = `<button class="task-btn" onclick="event.stopPropagation(); openTaskModal(${task.id})">
                Начать задание
            </button>`;
            break;
        case 'confirmation':
            buttonHtml = `<button class="task-btn" onclick="event.stopPropagation(); showTaskConfirmation(${task.id}, '${escapeHtml(task.title)}')">
                Отправить на проверку
            </button>`;
            break;
        case 'completed':
            buttonHtml = `<div class="task-status completed">✅ Выполнено</div>`;
            break;
        case 'rejected':
            buttonHtml = `<div class="task-status rejected">❌ Отклонено</div>`;
            break;
    }
    
    taskElement.innerHTML = `
        ${imageHtml}
        
        <div class="task-header">
            <div class="task-title">${escapeHtml(task.title)}</div>
            <div class="task-price">${task.price} ⭐</div>
        </div>
        
        <div class="task-meta">
            <div class="task-category">${formatCategory(task.category)}</div>
            ${task.difficulty ? `<div class="task-difficulty ${task.difficulty.toLowerCase()}">${task.difficulty}</div>` : ''}
        </div>
        
        <div class="task-description">
            ${escapeHtml(task.description.length > 100 ? task.description.substring(0, 100) + '...' : task.description)}
        </div>
        
        ${peopleRequired > 1 && category === 'new' ? `
            <div class="task-progress">
                <div class="task-progress-bar" style="width: ${Math.min(100, (completedCount / peopleRequired) * 100)}%"></div>
            </div>
            <div class="task-progress-text">
                Выполнено: ${completedCount}/${peopleRequired}
            </div>
        ` : ''}
        
        <div class="task-footer">
            <div class="task-time">
                ${category === 'confirmation' ? 'Ожидает подтверждения' : 
                  category === 'completed' ? 'Выполнено' :
                  category === 'rejected' ? 'Отклонено' : 
                  task.time_to_complete || '5-10 минут'}
            </div>
            ${buttonHtml}
        </div>
    `;
    
    if (category === 'new') {
        taskElement.addEventListener('click', function(e) {
            if (!e.target.classList.contains('task-btn')) {
                openTaskModal(task.id);
            }
        });
    }
    
    if (category === 'rejected') {
        taskElement.innerHTML = createRejectedTaskHTML(task);
    }
    
    return taskElement;
}

// 🔧 HTML ДЛЯ ОТКЛОНЕННЫХ ЗАДАНИЙ
function createRejectedTaskHTML(task) {
    return `
        <div class="task-header">
            <div style="flex: 1;">
                <div class="task-title">${escapeHtml(task.title)}</div>
                <div class="task-category">${task.category || 'Общее'}</div>
            </div>
            <div class="task-price">${task.price} ⭐</div>
        </div>
        <div class="task-description">${escapeHtml(task.description)}</div>
        
        <div class="rejection-info" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 10px; margin: 10px 0;">
            <div style="color: var(--error); font-size: 12px; font-weight: 600; margin-bottom: 5px;">
                ❌ Задание отклонено администратором
            </div>
            <div style="color: var(--text-secondary); font-size: 11px;">
                Если вы считаете, что это ошибка, напишите в поддержку
            </div>
        </div>
        
        <div class="task-footer">
            <div class="task-time">Отклонено</div>
            <button class="support-btn" onclick="openAdminChat()" style="background: var(--accent); color: white; border: none; padding: 8px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
                Написать в поддержку
            </button>
        </div>
    `;
}

// 🔧 ФУНКЦИЯ ФОРМАТИРОВАНИЯ КАТЕГОРИИ
function formatCategory(category) {
    const categoryMap = {
        'social': '👥 Соцсети ',
        'subscribe': '📱 Подписки', 
        'view': '👀 Просмотры',
        'comment': '💬 Комментарии',
        'repost': '🔄 Репосты',
        'general': '📋 Общее',
        'other': '🎯 Другое'
    };
    
    return categoryMap[category] || category;
}

// 🔧 ФУНКЦИИ ДЛЯ РАБОТЫ С МОДАЛЬНЫМИ ОКНАМИ ЗАДАНИЙ
function openTaskModal(taskId) {
    console.log('📖 Opening task modal for task:', taskId);
    console.log('📋 All available tasks:', allTasks);
    
    selectedTaskId = taskId;
    
    const task = allTasks.find(t => t.id === taskId);
    if (task) {
        console.log('✅ Task found:', task);
        
        document.getElementById('task-modal-title').textContent = task.title;
        document.getElementById('task-modal-category').textContent = task.category || 'Общее';
        document.getElementById('task-modal-price').textContent = `${task.price} ⭐`;
        document.getElementById('task-modal-description').textContent = task.description;
        
        const modalImageContainer = document.getElementById('task-modal-image-container');
        if (modalImageContainer) {
            if (task.image_url) {
                modalImageContainer.innerHTML = `
                    <div class="task-image-placeholder">
                        <div style="text-align: center;">
                            <div style="font-size: 32px; margin-bottom: 8px;">📋</div>
                            <div style="font-size: 12px;">Описание задания</div>
                        </div>
                    </div>
                `;
            } else {
                modalImageContainer.innerHTML = `
                    <div class="task-image-placeholder" style="aspect-ratio: 16/9;">
                        <div style="text-align: center; padding: 40px;">
                            <div style="font-size: 32px; margin-bottom: 8px;">📋</div>
                            <div>Описание задания</div>
                        </div>
                    </div>
                `;
            }
        }
        
        document.getElementById('task-modal-time').textContent = task.time_to_complete || '5 минут';
        document.getElementById('task-modal-difficulty').textContent = task.difficulty || 'Легкая';
        
        const peopleRequired = task.people_required || 1;
        const completedCount = task.completed_count || 0;
        const availableTasks = Math.max(0, peopleRequired - completedCount);
        document.getElementById('task-modal-available').textContent = `${availableTasks} заданий`;
        
        const taskUrl = task.task_url;
        const startButton = document.querySelector('.task-modal-start');
        
        if (taskUrl && taskUrl.startsWith('http')) {
            startButton.textContent = '🔗 Перейти к заданию';
            startButton.onclick = function() {
                console.log('🔗 Opening task URL:', taskUrl);
                window.open(taskUrl, '_blank');
                closeModal('task-modal');
                startTask();
            };
        } else {
            startButton.textContent = 'Начать задание';
            startButton.onclick = startTask;
        }
        
        document.getElementById('task-modal').classList.add('active');
        console.log('✅ Task modal opened successfully');
    } else {
        console.error('❌ Task not found in allTasks array');
        console.error('❌ Available task IDs:', allTasks.map(t => t.id));
        showNotification('Ошибка: задание не найдено. Попробуйте обновить список заданий.', 'error');
        
        setTimeout(() => {
            loadTasks();
        }, 2000);
    }
}

async function startTask() {
    console.log('🎯 Starting task...', { selectedTaskId, currentUser });
    
    if (!currentUser || !selectedTaskId) {
        showNotification('Ошибка: пользователь не авторизован или задание не выбрано', 'error');
        return;
    }

    try {
        console.log('📤 Sending start task request...');
        
        const result = await makeRequest('/api/user/tasks/start', {
            method: 'POST',
            body: JSON.stringify({
                userId: currentUser.id,
                taskId: selectedTaskId
            })
        });

        console.log('📨 Start task response:', result);

        if (result.success) {
            closeModal('task-modal');
            showNotification('✅ Задание начато! Выполните его и вернитесь для подтверждения.', 'success');
            
            setTimeout(() => {
                loadTasks();
                loadUserTasksForCategory('active');
            }, 500);
            
        } else {
            showNotification('❌ Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('💥 Error starting task:', error);
        showNotification('❌ Ошибка начала задания: ' + error.message, 'error');
    }
}

// 🔧 ФУНКЦИИ ДЛЯ ПОДТВЕРЖДЕНИЯ ВЫПОЛНЕНИЯ ЗАДАНИЙ
function showTaskConfirmation(userTaskId, taskName) {
    console.log('🔍 Confirming task:', { userTaskId, taskName });
    
    if (!userTaskId) {
        showNotification('Ошибка: ID задания не найден', 'error');
        return;
    }
    
    const numericTaskId = parseInt(userTaskId);
    if (isNaN(numericTaskId)) {
        showNotification('Ошибка: неверный ID задания', 'error');
        return;
    }
    
    currentUserTaskId = numericTaskId;
    
    const taskNameElement = document.getElementById('confirmation-task-name');
    const taskTextElement = document.getElementById('confirmation-task-text');
    
    if (taskNameElement) {
        taskNameElement.textContent = taskName;
    }
    
    if (taskTextElement) {
        taskTextElement.textContent = `Вы выполнили задание "${taskName}"?`;
    }
    
    const confirmationModal = document.getElementById('confirmation-modal');
    if (confirmationModal) {
        confirmationModal.classList.add('active');
        console.log('✅ Confirmation modal opened for task:', taskName);
    } else {
        console.error('❌ Confirmation modal not found');
        showNotification('Ошибка: модальное окно не найдено', 'error');
    }
}

function showScreenshotUpload() {
    closeModal('confirmation-modal');
    closeModal('cancel-confirmation-modal');
    
    document.getElementById('screenshot-file').value = '';
    document.getElementById('screenshot-preview').style.display = 'none';
    document.getElementById('file-name').textContent = '';
    
    const submitBtn = document.getElementById('submit-screenshot-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Отправить на проверку';
    }
            
    document.getElementById('screenshot-file').onchange = function(e) {
        const file = e.target.files[0];
        if (file) {
            document.getElementById('file-name').textContent = file.name;
            document.getElementById('submit-screenshot-btn').disabled = false;
            
            const reader = new FileReader();
            reader.onload = function(e) {
                const preview = document.getElementById('screenshot-preview');
                preview.src = e.target.result;
                preview.style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    };
    
    document.getElementById('screenshot-modal').classList.add('active');
}

function showCancelConfirmation() {
    closeModal('confirmation-modal');
    document.getElementById('cancel-confirmation-modal').classList.add('active');
}

async function submitScreenshot() {
    const fileInput = document.getElementById('screenshot-file');
    if (!fileInput.files[0]) {
        showNotification('Выберите файл скриншота', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('screenshot', fileInput.files[0]);
    formData.append('userId', currentUser.id);

    try {
        const response = await fetch(`${API_BASE_URL}/api/user/tasks/${currentUserTaskId}/submit`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            showNotification('Скриншот отправлен на проверку!', 'success');
            closeModal('screenshot-modal');
            loadUserTasks();
        } else {
            showNotification('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error submitting screenshot:', error);
        showNotification('Ошибка отправки скриншота', 'error');
    } finally {
        const submitBtn = document.getElementById('submit-screenshot-btn');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Отправить на проверку';
        }
    }
}

async function cancelTask() {
    if (!currentUserTaskId) return;

    try {
        const result = await makeRequest(`/user/tasks/${currentUserTaskId}/cancel`, {
            method: 'POST',
            body: JSON.stringify({
                userId: currentUser.id
            })
        });

        if (result.success) {
            showNotification('Задание отменено', 'success');
            closeModal('cancel-confirmation-modal');
            
            setTimeout(() => {
                loadTasks();
                loadUserTasks();
            }, 500);
            
        } else {
            showNotification('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error cancelling task:', error);
        showNotification('Ошибка отмены задания', 'error');
    }
}

// 🔧 ФУНКЦИИ ДЛЯ РАБОТЫ С КАТЕГОРИЯМИ ЗАДАНИЙ
function showTaskCategory(category) {
    console.log('🔄 Switching to category:', category);
    
    const tabs = document.querySelectorAll('.task-tab');
    const containers = document.querySelectorAll('.tasks-grid');
    
    tabs.forEach(tab => tab.classList.remove('active'));
    containers.forEach(container => {
        container.classList.remove('active');
        container.style.display = 'none';
    });
    
    const activeTab = Array.from(tabs).find(tab => 
        tab.textContent.toLowerCase().includes(getCategoryName(category))
    );
    if (activeTab) {
        activeTab.classList.add('active');
    }
    
    const targetContainer = document.getElementById(`${category}-tasks`);
    if (targetContainer) {
        targetContainer.classList.add('active');
        targetContainer.style.display = 'block';
        console.log(`✅ Контейнер ${category}-tasks показан`);
        
        if (category === 'new') {
            const searchText = document.getElementById('task-search').value.trim();
            const activeFilter = document.querySelector('.filter-btn.active');
            const filter = activeFilter ? activeFilter.getAttribute('data-filter') : 'all';
            
            loadTasks(searchText, filter);
        } else {
            loadTasksForCategory(category);
        }
    } else {
        console.error(`❌ Контейнер ${category}-tasks не найден`);
    }
}

function getCategoryName(category) {
    const names = {
        'new': 'новые',
        'confirmation': 'подтверждение', 
        'completed': 'выполненные',
        'rejected': 'отклоненные'
    };
    return names[category] || category;
}

async function loadTasksForCategory(category) {
    try {
        console.log(`🔄 Загружаем задания для категории: ${category} для пользователя:`, currentUser?.id);
        
        if (!currentUser) {
            console.log('❌ Пользователь не авторизован');
            return;
        }

        let endpoint = '';
        let params = new URLSearchParams();
        
        switch(category) {
            case 'new':
                endpoint = '/api/tasks';
                params.append('userId', currentUser.id);
                break;
            case 'confirmation':
                endpoint = `/api/user/${currentUser.id}/tasks/active`;
                break;
            case 'completed':
                endpoint = `/api/user/${currentUser.id}/tasks?status=completed`;
                break;
            case 'rejected':
                endpoint = `/api/user/${currentUser.id}/tasks?status=rejected`;
                break;
        }
        
        const url = endpoint + (params.toString() ? `?${params.toString()}` : '');
        console.log('📡 Request URL:', url);

        const result = await makeRequest(url);
        
        if (result.success) {
            displayTasksForCategory(result.tasks || [], category);
        } else {
            console.error(`❌ Ошибка загрузки ${category} заданий:`, result.error);
            showNotification(`Ошибка загрузки ${category} заданий`, 'error');
        }
    } catch (error) {
        console.error(`❌ Ошибка загрузки ${category} заданий:`, error);
        showNotification(`Ошибка загрузки ${category} заданий`, 'error');
    }
}

function displayTasksForCategory(tasks, category) {
    const container = document.getElementById(`${category}-tasks`);
    if (!container) {
        console.error(`❌ Контейнер ${category}-tasks не найден`);
        return;
    }
    
    container.innerHTML = '';
    
    if (!tasks || tasks.length === 0) {
        let message = '';
        switch(category) {
            case 'new':
                message = 'Новых заданий пока нет';
                break;
            case 'confirmation':
                message = 'Нет заданий на подтверждении';
                break;
            case 'completed':
                message = 'Нет выполненных заданий';
                break;
            case 'rejected':
                message = 'Нет отклоненных заданий';
                break;
        }
        
        container.innerHTML = `
            <div class="no-tasks" style="text-align: center; padding: 40px 20px;">
                <div style="font-size: 48px; margin-bottom: 16px;">📝</div>
                <div style="font-size: 18px; margin-bottom: 8px;">${message}</div>
                <div style="font-size: 14px; color: var(--text-secondary);">
                    ${category === 'new' ? 'Новые задания появятся позже' : 'Следите за обновлениями'}
                </div>
            </div>
        `;
        return;
    }
    
    console.log(`🎯 Отображаем ${tasks.length} заданий в категории ${category}`);
    
    tasks.forEach((task, index) => {
        const taskElement = createTaskCardWithImage(task, category, index);
        container.appendChild(taskElement);
    });
}

// 🔧 ФУНКЦИИ ДЛЯ РАБОТЫ С ЗАДАНИЯМИ ПОЛЬЗОВАТЕЛЯ
async function loadUserTasksForCategory(status) {
    if (!currentUser) return;
    
    try {
        console.log(`🔄 Loading user tasks for category: ${status}`);
        
        let endpoint = '';
        switch(status) {
            case 'active':
                endpoint = `/api/user/${currentUser.id}/tasks/active`;
                break;
            case 'completed':
                endpoint = `/api/user/${currentUser.id}/tasks?status=completed`;
                break;
            case 'rejected':
                endpoint = `/api/user/${currentUser.id}/tasks?status=rejected`;
                break;
            default:
                return;
        }
        
        const result = await makeRequest(endpoint);
        
        if (result.success) {
            const tasksWithCorrectId = result.tasks.map(task => ({
                ...task,
                id: task.id
            }));
            
            displayUserTasksForCategory(tasksWithCorrectId, status);
        } else {
            console.error('❌ Error loading user tasks:', result.error);
        }
    } catch (error) {
        console.error(`❌ Error loading ${status} tasks:`, error);
    }
}

function displayUserTasksForCategory(tasks, status) {
    let container = null;
    
    switch(status) {
        case 'active':
            container = document.getElementById('confirmation-tasks');
            break;
        case 'completed':
            container = document.getElementById('completed-tasks');
            break;
        case 'rejected':
            container = document.getElementById('rejected-tasks');
            break;
    }
    
    if (!container) {
        console.error(`❌ Container not found for status: ${status}`);
        return;
    }
    
    container.innerHTML = '';

    if (!tasks || tasks.length === 0) {
        let message = '';
        switch(status) {
            case 'active':
                message = 'Нет заданий на подтверждение';
                break;
            case 'completed':
                message = 'Нет выполненных заданий';
                break;
            case 'rejected':
                message = 'Нет отклоненных заданий';
                break;
        }
        
        container.innerHTML = `
            <div class="no-tasks" style="text-align: center; padding: 40px 20px;">
                <div style="font-size: 48px; margin-bottom: 16px;">📝</div>
                <div style="font-size: 18px; margin-bottom: 8px;">${message}</div>
                <div style="font-size: 14px; color: var(--text-secondary);">
                    ${status === 'active' ? 'Выполненные задания появятся здесь' : 'Следите за обновлениями'}
                </div>
            </div>
        `;
        return;
    }

    console.log(`🎯 Displaying ${tasks.length} tasks for ${status} category`);
    
    tasks.forEach((task, index) => {
        const taskElement = createTaskCardWithImage(task, status, index);
        container.appendChild(taskElement);
    });
}

async function loadUserTasks() {
    if (!currentUser) return;
    
    try {
        const activeResult = await makeRequest(`/user/${currentUser.id}/tasks?status=active`);
        if (activeResult.success) {
            displayUserTasksForCategory(activeResult.tasks, 'active');
        }
        
        const completedResult = await makeRequest(`/user/${currentUser.id}/tasks?status=completed`);
        if (completedResult.success) {
            displayUserTasksForCategory(completedResult.tasks, 'completed');
        }
        
        const rejectedResult = await makeRequest(`/user/${currentUser.id}/tasks?status=rejected`);
        if (rejectedResult.success) {
            displayUserTasksForCategory(rejectedResult.tasks, 'rejected');
        }
        
    } catch (error) {
        console.error('Error loading user tasks:', error);
    }
}

// 🔧 ФУНКЦИИ ДЛЯ ПОИСКА И ФИЛЬТРАЦИИ
function initializeSearch() {
    const searchInput = document.getElementById('task-search');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', function(e) {
            clearTimeout(searchTimeout);
            const searchText = e.target.value.trim();
            
            searchTimeout = setTimeout(() => {
                if (searchText.length >= 2 || searchText.length === 0) {
                    loadTasks(searchText, getActiveFilter());
                }
            }, 300);
        });
    }
    
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const filter = this.getAttribute('data-filter');
            loadTasks('', filter);
            
            filterButtons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });
}

function getActiveFilter() {
    const activeFilter = document.querySelector('.filter-btn.active');
    return activeFilter ? activeFilter.getAttribute('data-filter') : 'all';
}

function clearFilters() {
    console.log('🔄 Clearing all filters');
    
    const searchInput = document.getElementById('task-search');
    if (searchInput) {
        searchInput.value = '';
    }
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');
    
    const filterInfo = document.getElementById('filter-info');
    if (filterInfo) {
        filterInfo.remove();
    }
    
    loadTasks();
}

// 🔧 ИНИЦИАЛИЗАЦИЯ ОБРАБОТЧИКОВ
function initializeTaskTabHandlers() {
    const taskTabs = document.querySelectorAll('.task-tab');
    taskTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const category = getCategoryFromTab(this.textContent);
            if (category) {
                showTaskCategory(category);
            }
        });
    });
}

function getCategoryFromTab(tabText) {
    const text = tabText.toLowerCase();
    if (text.includes('новые')) return 'new';
    if (text.includes('подтверждение')) return 'confirmation';
    if (text.includes('выполненные')) return 'completed';
    if (text.includes('отклоненные')) return 'rejected';
    return null;
}

// 🔧 ЭКСПОРТ ФУНКЦИЙ
window.filterTasks = filterTasks;
window.clearFilters = clearFilters;
window.loadTasks = loadTasks;
window.showTaskCategory = showTaskCategory;
window.loadTasksForCategory = loadTasksForCategory;
window.displayTasksForCategory = displayTasksForCategory;
window.openTaskModal = openTaskModal;
window.startTask = startTask;
window.showTaskConfirmation = showTaskConfirmation;
window.showScreenshotUpload = showScreenshotUpload;
window.showCancelConfirmation = showCancelConfirmation;
window.submitScreenshot = submitScreenshot;
window.cancelTask = cancelTask;
window.loadUserTasksForCategory = loadUserTasksForCategory;
window.displayUserTasksForCategory = displayUserTasksForCategory;
window.loadUserTasks = loadUserTasks;
window.initializeSearch = initializeSearch;
window.initializeTaskTabHandlers = initializeTaskTabHandlers;