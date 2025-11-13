// 🔧 ФУНКЦИИ ДЛЯ РАБОТЫ С ЧАТОМ И ПОДДЕРЖКОЙ

// 🔧 ОСНОВНЫЕ ФУНКЦИИ ЧАТА
async function openAdminChat() {
    if (!currentUser) {
        showNotification('Пользователь не авторизован', 'error');
        return;
    }
    
    try {
        console.log('👤 User opening support chat, ID:', currentUser.id);
        
        const chatResult = await makeRequest(`/support/user-chat/${currentUser.id}`);
        
        if (chatResult.success) {
            currentChatId = chatResult.chat.id;
            console.log('✅ Chat ID:', currentChatId);
            
            try {
                const messagesResult = await makeRequest(`/support/chats/${currentChatId}/messages`);
                if (messagesResult.success) {
                    displayChatMessages(messagesResult.messages);
                }
            } catch (messagesError) {
                console.log('No messages yet or error loading messages:', messagesError);
                displayChatMessages([]);
            }
            
            document.getElementById('admin-chat').classList.add('active');
            
        } else {
            throw new Error(chatResult.error || 'Failed to create chat');
        }
    } catch (error) {
        console.error('❌ Error opening user chat:', error);
        showNotification('Ошибка открытия чата: ' + error.message, 'error');
    }
}

function displayChatMessages(messages) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;
    
    messagesContainer.innerHTML = '';
    
    if (!messages || messages.length === 0) {
        const welcomeMessage = document.createElement('div');
        welcomeMessage.className = 'message message-admin';
        welcomeMessage.innerHTML = `
            <div class="message-text">Здравствуйте! Чем могу помочь?</div>
            <div class="message-time">${new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'})}</div>
        `;
        messagesContainer.appendChild(welcomeMessage);
        return;
    }
    
    messages.forEach(message => {
        const messageElement = document.createElement('div');
        messageElement.className = message.is_admin ? 'message message-admin' : 'message message-user';
        
        messageElement.innerHTML = `
            <div class="message-text">${escapeHtml(message.message)}</div>
            <div class="message-time">${formatPostDate(message.sent_at)}</div>
        `;
        messagesContainer.appendChild(messageElement);
    });
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function sendMessageToAdmin() {
    if (!currentUser || !currentChatId) {
        showNotification('Чат не открыт', 'error');
        return;
    }
    
    const input = document.getElementById('chat-input-field');
    const message = input.value.trim();
    
    if (!message) {
        showNotification('Введите сообщение', 'error');
        return;
    }
    
    try {
        console.log(`✉️ User sending message to chat ${currentChatId}:`, message);
        
        const userFullName = currentUser.lastName ? 
            `${currentUser.firstName} ${currentUser.lastName}` : 
            currentUser.firstName;
        
        const result = await makeRequest(`/support/chats/${currentChatId}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                user_id: currentUser.id,
                user_name: userFullName,
                user_username: currentUser.username,
                message: message,
                is_admin: false
            })
        });
        
        if (result.success) {
            const messagesContainer = document.getElementById('chat-messages');
            const messageElement = document.createElement('div');
            messageElement.className = 'message message-user';
            messageElement.innerHTML = `
                <div class="message-text">${escapeHtml(message)}</div>
                <div class="message-time">${new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'})}</div>
            `;
            messagesContainer.appendChild(messageElement);
            
            input.value = '';
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            
            showNotification('Сообщение отправлено! Администратор ответит в ближайшее время.', 'success');
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('❌ Error sending message:', error);
        showNotification('Ошибка отправки: ' + error.message, 'error');
    }
}

function closeChat() {
    document.getElementById('admin-chat').classList.remove('active');
    currentChatId = null;
}

// 🔧 ФУНКЦИИ ДЛЯ АДМИН-ЧАТОВ
async function loadAdminChats() {
    if (!currentUser) return;
    
    try {
        console.log('📥 Loading admin chats...');
        const result = await makeRequest(`/support/chats`);
        
        if (result.success) {
            console.log(`✅ Loaded ${result.chats?.length || 0} active chats`);
            displayAdminChatsList(result.chats || []);
        } else {
            console.error('❌ Failed to load chats:', result.error);
        }
    } catch (error) {
        console.error('❌ Error loading admin chats:', error);
    }
}

async function loadAllAdminChats() {
    if (!currentUser || !currentUser.isAdmin) return;
    
    try {
        const result = await makeRequest(`/support/all-chats?adminId=${ADMIN_ID}`);
        if (result.success) {
            displayAllAdminChats(result.chats || []);
        }
    } catch (error) {
        console.error('Error loading all chats:', error);
    }
}

async function loadArchivedAdminChats() {
    if (!currentUser || !currentUser.isAdmin) return;
    
    try {
        const result = await makeRequest(`/support/archived-chats?adminId=${ADMIN_ID}`);
        if (result.success) {
            displayArchivedAdminChats(result.chats || []);
        }
    } catch (error) {
        console.error('Error loading archived chats:', error);
    }
}

function displayAdminChatsList(chats) {
    const container = document.getElementById('active-chats-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!chats || chats.length === 0) {
        container.innerHTML = ``;
        return;
    }
    
    updateChatsStats(chats);
    
    chats.forEach(chat => {
        const chatElement = createChatElement(chat, 'active');
        container.appendChild(chatElement);
    });
}

function displayAllAdminChats(chats) {
    const container = document.getElementById('all-chats-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!chats || chats.length === 0) {
        container.innerHTML = ``;
        return;
    }
    
    chats.forEach(chat => {
        const chatElement = createChatElement(chat, 'all');
        container.appendChild(chatElement);
    });
}

function displayArchivedAdminChats(chats) {
    const container = document.getElementById('archived-chats-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!chats || chats.length === 0) {
        container.innerHTML = `
            <div class="no-tasks" style="text-align: center; padding: 20px;">
                <div>Нет архивных чатов</div>
            </div>
        `;
        return;
    }
    
    chats.forEach(chat => {
        const chatElement = createChatElement(chat, 'archived');
        container.appendChild(chatElement);
    });
}

function createChatElement(chat, listType) {
    const chatElement = document.createElement('div');
    const isUnread = chat.unread_count > 0;
    const isArchived = !chat.is_active;
    
    chatElement.className = `chat-item ${isUnread ? 'unread' : ''} ${isArchived ? 'archived' : ''}`;
    chatElement.onclick = () => openAdminChatWindow(chat);
    
    const avatarText = chat.user_name ? chat.user_name.charAt(0).toUpperCase() : 'U';
    const displayName = chat.user_name || `User_${chat.user_id}`;
    const lastMessage = chat.last_message || 'Нет сообщений';
    
    chatElement.innerHTML = `
        <div class="chat-avatar-small">
            ${avatarText}
        </div>
        <div class="chat-info-small">
            <div class="chat-name-small">
                ${displayName}
                ${isArchived ? '<span class="archived-badge">архив</span>' : ''}
            </div>
            <div class="chat-last-message">${lastMessage}</div>
        </div>
        <div class="chat-meta">
            <div class="chat-time">${chat.moscow_time || formatPostDate(chat.last_message_time)}</div>
            ${isUnread ? `<div class="unread-badge">${chat.unread_count}</div>` : ''}
        </div>
        ${listType === 'all' || listType === 'archived' ? `
            <div class="chat-actions">
                ${isArchived ? `
                    <button class="chat-action-btn chat-restore-btn" onclick="event.stopPropagation(); restoreChat(${chat.id})" title="Восстановить">
                        ↻
                    </button>
                ` : `
                    <button class="chat-action-btn chat-archive-btn" onclick="event.stopPropagation(); archiveChat(${chat.id})" title="В архив">
                        📁
                    </button>
                `}
                <button class="chat-action-btn chat-delete-btn" onclick="event.stopPropagation(); deleteAdminChat(${chat.id})" title="Удалить">
                    🗑️
                </button>
            </div>
        ` : ''}
    `;
    
    return chatElement;
}

function updateChatsStats(chats) {
    const activeChats = chats.filter(chat => chat.is_active).length;
    const unreadChats = chats.filter(chat => chat.unread_count > 0).length;
    const totalChats = chats.length;
    
    const activeCount = document.getElementById('active-chats-count');
    const unreadCount = document.getElementById('unread-chats-count');
    const totalCount = document.getElementById('total-chats-count');
    
    if (activeCount) activeCount.textContent = activeChats;
    if (unreadCount) unreadCount.textContent = unreadChats;
    if (totalCount) totalCount.textContent = totalChats;
}

function showChatTab(tab) {
    const activeList = document.getElementById('active-chats-list');
    const archivedList = document.getElementById('archived-chats-list');
    const allList = document.getElementById('all-chats-list');
    
    if (activeList) activeList.style.display = 'none';
    if (archivedList) archivedList.style.display = 'none';
    if (allList) allList.style.display = 'none';
    
    document.querySelectorAll('.chat-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const buttons = document.querySelectorAll('.chat-tab-btn');
    switch(tab) {
        case 'active':
            if (activeList) activeList.style.display = 'block';
            buttons[0]?.classList.add('active');
            loadAdminChats();
            break;
        case 'archived':
            if (archivedList) archivedList.style.display = 'block';
            buttons[1]?.classList.add('active');
            loadArchivedAdminChats();
            break;
        case 'all':
            if (allList) allList.style.display = 'block';
            buttons[2]?.classList.add('active');
            loadAllAdminChats();
            break;
    }
}

// 🔧 ФУНКЦИИ ДЛЯ РАБОТЫ С ОКНОМ АДМИН-ЧАТА
async function openAdminChatWindow(chat) {
    console.log('💬 Admin opening chat:', chat);
    currentAdminChat = chat;
    
    try {
        const messagesResult = await makeRequest(`/support/chats/${chat.id}/messages`);
        if (messagesResult.success) {
            console.log(`📨 Loaded ${messagesResult.messages.length} messages for admin chat`);
            
            try {
                await makeRequest(`/support/chats/${chat.id}/read`, {
                    method: 'PUT'
                });
                loadAdminChats();
            } catch (readError) {
                console.log('Mark as read not available');
            }
            
            showAdminChatWindow(chat, messagesResult.messages);
        } else {
            throw new Error('Failed to load messages');
        }
    } catch (error) {
        console.error('❌ Error opening admin chat:', error);
        showNotification('Ошибка открытия чата: ' + error.message, 'error');
    }
}

function showAdminChatWindow(chat, messages) {
    let chatWindow = document.getElementById('admin-chat-window');
    if (!chatWindow) {
        createAdminChatWindow();
        chatWindow = document.getElementById('admin-chat-window');
    }
    
    const chatUserName = document.getElementById('admin-chat-user-name');
    const chatUserAvatar = document.getElementById('admin-chat-avatar');
    
    if (chatUserName) {
        chatUserName.textContent = chat.user_name || `User_${chat.user_id}`;
    }
    
    if (chatUserAvatar) {
        chatUserAvatar.textContent = chat.user_name ? chat.user_name.charAt(0).toUpperCase() : 'U';
    }
    
    displayAdminChatMessages(messages);
    chatWindow.classList.add('active');
}

function createAdminChatWindow() {
    const chatWindowHTML = `
        <div class="admin-chat-window" id="admin-chat-window">
            <div class="admin-chat-header">
                <div class="admin-chat-user">
                    <div class="chat-avatar-small" id="admin-chat-avatar">U</div>
                    <div class="chat-info-small">
                        <div class="chat-name-small" id="admin-chat-user-name">User</div>
                        <div class="chat-status">Онлайн</div>
                    </div>
                </div>
                <button class="chat-close" onclick="closeAdminChat()">×</button>
            </div>
            <div class="admin-chat-messages" id="admin-chat-messages">
                <!-- Сообщения будут загружены здесь -->
            </div>
            <div class="admin-chat-input-container">
                <input type="text" id="admin-chat-input" placeholder="Введите сообщение..." onkeypress="if(event.key==='Enter') sendAdminMessage()">
                <button class="admin-chat-send" onclick="sendAdminMessage()">➤</button>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', chatWindowHTML);
}

function displayAdminChatMessages(messages) {
    const container = document.getElementById('admin-chat-messages');
    if (!container) {
        console.error('Admin chat messages container not found!');
        return;
    }
    
    container.innerHTML = '';
    
    if (!messages || messages.length === 0) {
        const welcomeMessage = document.createElement('div');
        welcomeMessage.className = 'message message-admin';
        welcomeMessage.innerHTML = `
            <div class="message-text">Начните диалог с пользователем</div>
            <div class="message-time">${new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'})}</div>
        `;
        container.appendChild(welcomeMessage);
        return;
    }
    
    messages.forEach(message => {
        const messageElement = document.createElement('div');
        messageElement.className = message.is_admin ? 'message message-admin' : 'message message-user';
        
        let messageContent = '';
        if (message.image_url) {
            messageContent = `
                <div class="message-image">
                    <img src="${message.image_url}" alt="Фото" style="max-width: 200px; border-radius: 10px;">
                </div>
            `;
        } else {
            messageContent = `<div class="message-text">${escapeHtml(message.message)}</div>`;
        }
        
        messageElement.innerHTML = `
            ${messageContent}
            <div class="message-time">${message.moscow_time || formatPostDate(message.sent_at)}</div>
        `;
        container.appendChild(messageElement);
    });
    
    container.scrollTop = container.scrollHeight;
}

async function sendAdminMessage() {
    if (!currentAdminChat || !currentUser) {
        console.error('No active chat or user');
        showNotification('Чат не выбран', 'error');
        return;
    }
    
    const input = document.getElementById('admin-chat-input');
    if (!input) {
        console.error('Admin chat input not found');
        return;
    }
    
    const message = input.value.trim();
    
    if (!message) {
        showNotification('Введите сообщение', 'error');
        return;
    }
    
    try {
        console.log(`✉️ Admin sending message to chat ${currentAdminChat.id}:`, message);
        
        const result = await makeRequest(`/support/chats/${currentAdminChat.id}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                user_id: currentUser.id,
                user_name: 'Администратор',
                user_username: currentUser.username,
                message: message,
                is_admin: true
            })
        });
        
        if (result.success) {
            const messagesContainer = document.getElementById('admin-chat-messages');
            if (messagesContainer) {
                const messageElement = document.createElement('div');
                messageElement.className = 'message message-admin';
                messageElement.innerHTML = `
                    <div class="message-text">${escapeHtml(message)}</div>
                    <div class="message-time">${new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'})}</div>
                `;
                messagesContainer.appendChild(messageElement);
                
                input.value = '';
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
                
                loadAdminChats();
                
                console.log('✅ Admin message sent successfully');
                showNotification('Сообщение отправлено', 'success');
            }
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('❌ Error sending admin message:', error);
        showNotification('Ошибка отправки сообщения: ' + error.message, 'error');
    }
}

function closeAdminChat() {
    const chatWindow = document.getElementById('admin-chat-window');
    if (chatWindow) {
        chatWindow.classList.remove('active');
    }
    currentAdminChat = null;
}

// 🔧 ФУНКЦИИ ДЛЯ УПРАВЛЕНИЯ ЧАТАМИ
async function archiveChat(chatId) {
    if (!confirm('Переместить чат в архив?')) return;

    try {
        const result = await makeRequest(`/support/chats/${chatId}/archive`, {
            method: 'PUT',
            body: JSON.stringify({ adminId: currentUser.id })
        });

        if (result.success) {
            showNotification('Чат перемещен в архив', 'success');
            loadAdminChats();
            loadAllAdminChats();
        } else {
            showNotification('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error archiving chat:', error);
        showNotification('Ошибка архивации чата', 'error');
    }
}

async function restoreChat(chatId) {
    try {
        const result = await makeRequest(`/support/chats/${chatId}/restore`, {
            method: 'PUT',
            body: JSON.stringify({ adminId: currentUser.id })
        });

        if (result.success) {
            showNotification('Чат восстановлен', 'success');
            loadAdminChats();
            loadAllAdminChats();
            loadArchivedAdminChats();
        } else {
            showNotification('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error restoring chat:', error);
        showNotification('Ошибка восстановления чата', 'error');
    }
}

async function deleteAdminChat(chatId) {
    if (!confirm('Удалить этот чат? Все сообщения будут удалены.')) return;

    try {
        const result = await makeRequest(`/support/chats/${chatId}`, {
            method: 'DELETE',
            body: JSON.stringify({ adminId: currentUser.id })
        });

        if (result.success) {
            showNotification('Чат удален', 'success');
            loadAdminChats();
            loadAllAdminChats();
            loadArchivedAdminChats();
            
            if (currentAdminChat && currentAdminChat.id === chatId) {
                closeAdminChat();
            }
        } else {
            showNotification('Ошибка: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error deleting chat:', error);
        showNotification('Ошибка удаления чата', 'error');
    }
}

// 🔧 ЭКСПОРТ ФУНКЦИЙ
window.openAdminChat = openAdminChat;
window.closeChat = closeChat;
window.sendMessageToAdmin = sendMessageToAdmin;
window.loadAdminChats = loadAdminChats;
window.loadAllAdminChats = loadAllAdminChats;
window.loadArchivedAdminChats = loadArchivedAdminChats;
window.openAdminChatWindow = openAdminChatWindow;
window.sendAdminMessage = sendAdminMessage;
window.closeAdminChat = closeAdminChat;
window.deleteAdminChat = deleteAdminChat;
window.archiveChat = archiveChat;
window.restoreChat = restoreChat;
window.showChatTab = showChatTab;