const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// Конфигурация для Railway
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_ID = 8036875641;
const APP_URL = process.env.RAILWAY_STATIC_URL || process.env.APP_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` || 'https://your-app.com';

// Инициализация бота только если есть токен
let bot;
if (BOT_TOKEN) {
    bot = new TelegramBot(BOT_TOKEN, { polling: true });
    console.log('🤖 Telegram Bot initialized');
} else {
    console.log('⚠️ BOT_TOKEN not set - Telegram features disabled');
}

// Используйте переменную окружения от Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
// Автоматические ping-запросы каждые 5 минут
// Автоматические ping-запросы к базе каждые 5 минут
setInterval(async () => {
    try {
        await pool.query('SELECT 1');
        console.log('✅ Database ping successful');
    } catch (error) {
        console.error('❌ Database ping failed:', error);
    }
}, 5 * 60 * 1000); // 5 минут

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'PUT'],
    credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('.'));

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadsDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExt = path.extname(file.originalname);
        // Добавляем префикс для легкой идентификации
        cb(null, 'screenshot-' + uniqueSuffix + fileExt);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: function (req, file, cb) {
        // Разрешаем только изображения
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// Функция для отправки уведомления пользователю
async function sendTaskNotification(userId, taskTitle, status, adminComment = '') {
    if (!bot) {
        console.log('⚠️ Bot not initialized, cannot send notification');
        return false;
    }

    try {
        let message = '';
        
        if (status === 'approved') {
            message = `🎉 <b>Задание одобрено!</b>\n\n` +
                     `Задание: "<b>${taskTitle}</b>"\n` +
                     `✅ Статус: <b>Одобрено</b>\n` +
                     `💫 Средства зачислены на ваш баланс!`;
        } else if (status === 'rejected') {
            message = `❌ <b>Задание отклонено</b>\n\n` +
                     `Задание: "<b>${taskTitle}</b>"\n` +
                     `📝 Статус: <b>Отклонено</b>\n` +
                     `💡 Вы можете взять другое задание`;
            
            if (adminComment) {
                message += `\n\n📋 <b>Комментарий администратора:</b>\n${adminComment}`;
            }
        }

        await bot.sendMessage(userId, message, { parse_mode: 'HTML' });
        console.log(`✅ Уведомление отправлено пользователю ${userId} о статусе задания "${taskTitle}"`);
        return true;
    } catch (error) {
        console.error(`❌ Ошибка отправки уведомления пользователю ${userId}:`, error.message);
        
        // Если пользователь заблокировал бота, пропускаем ошибку
        if (error.response && error.response.statusCode === 403) {
            console.log(`🚫 Пользователь ${userId} заблокировал бота`);
            return false;
        }
        
        return false;
    }
}

async function checkAdminAccess(userId) {
    try {
        console.log('🔐 Checking admin access for user:', userId);
        
        const result = await pool.query(
            'SELECT is_admin FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        if (result.rows.length > 0) {
            const isAdmin = result.rows[0].is_admin === true || parseInt(userId) === ADMIN_ID;
            console.log(`✅ Admin check result for ${userId}: ${isAdmin}`);
            return isAdmin;
        }
        
        console.log(`❌ User ${userId} not found in database`);
        return parseInt(userId) === ADMIN_ID;
        
    } catch (error) {
        console.error('❌ Admin access check error:', error);
        return parseInt(userId) === ADMIN_ID;
    }
}
// Логирование состояния базы данных
setInterval(async () => {
    try {
        const result = await pool.query(`
            SELECT 
                count(*) as total_tasks,
                count(CASE WHEN status = 'active' THEN 1 END) as active_tasks,
                count(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks
            FROM tasks
        `);
        
        const userStats = await pool.query(`
            SELECT 
                count(*) as total_users,
                count(CASE WHEN is_admin = true THEN 1 END) as admin_users
            FROM user_profiles
        `);
        
        console.log('📊 Database Stats:', {
            tasks: result.rows[0],
            users: userStats.rows[0],
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Database stats error:', error);
    }
}, 15 * 60 * 1000); // Каждые 15 минут

async function fixPromocodesTable() {
    try {
        console.log('🔧 Fixing promocodes table structure...');
        
        // Проверяем существование таблицы
        const tableExists = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'promocodes'
            )
        `);
        
        if (!tableExists.rows[0].exists) {
            console.log('❌ Promocodes table does not exist, creating...');
            await createPromocodesTable();
            return;
        }
        
        console.log('✅ Promocodes table exists, checking columns...');
        
        // Добавляем отсутствующие колонки
        const alterQueries = [
            `ALTER TABLE promocodes ADD COLUMN IF NOT EXISTS reward REAL NOT NULL DEFAULT 0`,
            `ALTER TABLE promocodes ADD COLUMN IF NOT EXISTS max_uses INTEGER NOT NULL DEFAULT 1`,
            `ALTER TABLE promocodes ADD COLUMN IF NOT EXISTS used_count INTEGER DEFAULT 0`,
            `ALTER TABLE promocodes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`,
            `ALTER TABLE promocodes ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`,
            `ALTER TABLE promocodes ADD COLUMN IF NOT EXISTS created_by BIGINT NOT NULL DEFAULT ${ADMIN_ID}`,
            `ALTER TABLE promocodes ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
        ];
        
        for (const query of alterQueries) {
            try {
                await pool.query(query);
                console.log(`✅ Executed: ${query.split('ADD COLUMN IF NOT EXISTS')[1]?.split(' ')[1]}`);
            } catch (error) {
                console.log(`⚠️ Could not execute: ${query}`, error.message);
            }
        }
        
        console.log('✅ Promocodes table structure fixed');
    } catch (error) {
        console.error('❌ Error fixing promocodes table:', error);
    }
}
async function initDatabase() {
    try {
        console.log('🔄 Initializing simplified database...');

await pool.query(`
CREATE TABLE IF NOT EXISTS referral_links 
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_by BIGINT NOT NULL,
    referral_url TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES user_profiles(user_id)
)
    `);
await pool.query(`CREATE TABLE IF NOT EXISTS referral_link_clicks (
    id SERIAL PRIMARY KEY,
    link_id INTEGER NOT NULL,
    user_id BIGINT,
    ip_address TEXT,
    user_agent TEXT,
    clicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (link_id) REFERENCES referral_links(id))
`);
// Таблица активаций реферальных ссылок
await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_activations (
        id SERIAL PRIMARY KEY,
        link_id INTEGER NOT NULL,
        user_id BIGINT NOT NULL,
        activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reward_amount REAL DEFAULT 0,
        FOREIGN KEY (link_id) REFERENCES referral_links(id),
        FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
    )
`);

// Таблица настроек админ-панели
await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        allow_admins_links BOOLEAN DEFAULT false,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`);

// Добавьте колонку для прав создания ссылок
await pool.query(`
    ALTER TABLE admin_permissions 
    ADD COLUMN IF NOT EXISTS can_create_links BOOLEAN DEFAULT false
`);
        // Таблица для лога уведомлений
        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_notifications (
                id SERIAL PRIMARY KEY,
                admin_id BIGINT NOT NULL,
                message TEXT NOT NULL,
                sent_count INTEGER DEFAULT 0,
                failed_count INTEGER DEFAULT 0,
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица пользователей
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_profiles (
                user_id BIGINT PRIMARY KEY,
                username TEXT,
                first_name TEXT,
                last_name TEXT,
                photo_url TEXT,
                balance REAL DEFAULT 0,
                level INTEGER DEFAULT 1,
                is_admin BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Добавляем реферальные поля
        await pool.query(`
            ALTER TABLE user_profiles 
            ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
            ADD COLUMN IF NOT EXISTS referred_by BIGINT,
            ADD COLUMN IF NOT EXISTS referral_count INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS referral_earned REAL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS is_first_login BOOLEAN DEFAULT true
        `);

        // Таблица заданий - ОБНОВЛЕННАЯ ВЕРСИЯ С image_url
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                price REAL NOT NULL,
                created_by BIGINT NOT NULL,
                category TEXT DEFAULT 'general',
                time_to_complete TEXT DEFAULT '5 минут',
                difficulty TEXT DEFAULT 'Легкая',
                people_required INTEGER DEFAULT 1,
                repost_time TEXT DEFAULT '1 день',
                task_url TEXT,
                image_url TEXT,
                status TEXT DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Гарантируем, что колонка image_url существует
        await pool.query(`
            ALTER TABLE tasks 
            ADD COLUMN IF NOT EXISTS image_url TEXT
        `);

        // Таблица запросов на вывод
        await pool.query(`
            CREATE TABLE IF NOT EXISTS withdrawal_requests (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                username TEXT,
                first_name TEXT,
                amount REAL NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                completed_by BIGINT
            )
        `);

        // Таблица постов
        await pool.query(`
            CREATE TABLE IF NOT EXISTS posts (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                author TEXT NOT NULL,
                author_id BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица чатов поддержки
        await pool.query(`
            CREATE TABLE IF NOT EXISTS support_chats (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                user_name TEXT NOT NULL,
                user_username TEXT,
                last_message TEXT,
                last_message_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true,
                unread_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица заданий пользователей
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_tasks (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                task_id INTEGER NOT NULL,
                status TEXT DEFAULT 'active',
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                screenshot_url TEXT,
                submitted_at TIMESTAMP,
                completed_at TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_actions (
                id SERIAL PRIMARY KEY,
                admin_id BIGINT NOT NULL,
                action_type TEXT NOT NULL,
                target_id INTEGER,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // Таблица проверки заданий
        await pool.query(`
            CREATE TABLE IF NOT EXISTS task_verifications (
                id SERIAL PRIMARY KEY,
                user_task_id INTEGER NOT NULL,
                user_id BIGINT NOT NULL,
                task_id INTEGER NOT NULL,
                user_name TEXT NOT NULL,
                user_username TEXT,
                task_title TEXT NOT NULL,
                task_price REAL NOT NULL,
                screenshot_url TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reviewed_at TIMESTAMP,
                reviewed_by BIGINT
            )
        `);

        // В initDatabase() добавьте:
        await createPromocodesTable();

        // Таблица сообщений
        await pool.query(`
            CREATE TABLE IF NOT EXISTS support_messages (
                id SERIAL PRIMARY KEY,
                chat_id INTEGER NOT NULL,
                user_id BIGINT NOT NULL,
                user_name TEXT NOT NULL,
                user_username TEXT,
                message TEXT NOT NULL,
                is_admin BOOLEAN DEFAULT false,
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица прав доступа администраторов
        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_permissions (
                admin_id BIGINT PRIMARY KEY,
                can_posts BOOLEAN DEFAULT true,
                can_tasks BOOLEAN DEFAULT true,
                can_verification BOOLEAN DEFAULT true,
                can_support BOOLEAN DEFAULT true,
                can_payments BOOLEAN DEFAULT true,
                can_admins BOOLEAN DEFAULT false,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (admin_id) REFERENCES user_profiles(user_id)
            )
        `);

        // Добавляем недостающие колонки
        await pool.query(`
            ALTER TABLE support_chats 
            ADD COLUMN IF NOT EXISTS user_username TEXT,
            ADD COLUMN IF NOT EXISTS unread_count INTEGER DEFAULT 0
        `);
        
        await pool.query(`
            ALTER TABLE tasks 
            ADD COLUMN IF NOT EXISTS created_by BIGINT,
            ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general',
            ADD COLUMN IF NOT EXISTS time_to_complete TEXT DEFAULT '5 минут',
            ADD COLUMN IF NOT EXISTS difficulty TEXT DEFAULT 'Легкая',
            ADD COLUMN IF NOT EXISTS people_required INTEGER DEFAULT 1,
            ADD COLUMN IF NOT EXISTS repost_time TEXT DEFAULT '1 день',
            ADD COLUMN IF NOT EXISTS task_url TEXT
        `);

        // Добавляем колонку user_username в task_verifications если ее нет
        await pool.query(`
            ALTER TABLE task_verifications 
            ADD COLUMN IF NOT EXISTS user_username TEXT
        `);

        // Добавляем колонку user_username в support_messages если ее нет
        await pool.query(`
            ALTER TABLE support_messages 
            ADD COLUMN IF NOT EXISTS user_username TEXT
        `);

        // Гарантируем существование главного админа
        await pool.query(`
            INSERT INTO user_profiles 
            (user_id, username, first_name, last_name, is_admin) 
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id) 
            DO UPDATE SET 
                is_admin = true,
                updated_at = CURRENT_TIMESTAMP
        `, [ADMIN_ID, 'linkgold_admin', 'Главный', 'Администратор', true]);

        // Создаем тестовые задания если их нет
        const tasksCount = await pool.query('SELECT COUNT(*) FROM tasks WHERE status = $1', ['active']);
        if (parseInt(tasksCount.rows[0].count) === 0) {
            console.log('📝 Создаем тестовые задания...');
            await pool.query(`
                INSERT INTO tasks (title, description, price, created_by, category) 
                VALUES 
                ('Подписаться на канал', 'Подпишитесь на наш Telegram канал и оставайтесь подписанным минимум 3 дня', 50, $1, 'subscribe'),
                ('Посмотреть видео', 'Посмотрите видео до конца и поставьте лайк', 30, $1, 'view'),
                ('Сделать репост', 'Сделайте репост записи в своем канале', 70, $1, 'repost'),
                ('Оставить комментарий', 'Напишите содержательный комментарий под постом', 40, $1, 'comment'),
                ('Вступить в группу', 'Вступите в нашу Telegram группу', 60, $1, 'social')
            `, [ADMIN_ID]);
            console.log('✅ Тестовые задания созданы');
        }
// В функции initDatabase() добавьте:
async function addMissingUserColumns() {
    try {
        console.log('🔧 Adding missing columns to user_profiles...');
        
        const columnsToAdd = [
            'is_blocked BOOLEAN DEFAULT false',
            'tasks_completed INTEGER DEFAULT 0',
            'last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
        ];
        
        for (const columnDef of columnsToAdd) {
            const columnName = columnDef.split(' ')[0];
            try {
                await pool.query(`
                    ALTER TABLE user_profiles 
                    ADD COLUMN IF NOT EXISTS ${columnDef}
                `);
                console.log(`✅ Added column: ${columnName}`);
            } catch (error) {
                console.log(`ℹ️ Column ${columnName} already exists:`, error.message);
            }
        }
        
        console.log('✅ User table structure verified');
    } catch (error) {
        console.error('❌ Error adding user columns:', error);
    }
}

// Вызовите эту функцию в initDatabase()
await addMissingUserColumns();
        // Создаем тестовый пост если нет постов
        const postsCount = await pool.query('SELECT COUNT(*) FROM posts');
        if (parseInt(postsCount.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO posts (title, content, author, author_id) 
                VALUES ('Добро пожаловать!', 'Начните зарабатывать выполняя простые задания!', 'Администратор', $1)
            `, [ADMIN_ID]);
        }

        // ВРЕМЕННОЕ РЕШЕНИЕ - проверяем таблицу промокодов
        try {
            console.log('🔧 Checking promocodes table...');
            await pool.query(`
                CREATE TABLE IF NOT EXISTS promocodes (
                    id SERIAL PRIMARY KEY,
                    code VARCHAR(20) UNIQUE NOT NULL,
                    reward REAL NOT NULL DEFAULT 0,
                    max_uses INTEGER NOT NULL DEFAULT 1,
                    used_count INTEGER DEFAULT 0,
                    expires_at TIMESTAMP,
                    is_active BOOLEAN DEFAULT true,
                    created_by BIGINT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ Promocodes table verified');
        } catch (error) {
            console.log('⚠️ Promocodes table check:', error.message);
        }
        
        console.log('✅ Database initialized successfully');
    } catch (error) {
        console.error('❌ Database initialization error:', error);
    }
}
async function createPromocodesTable() {
    try {
        console.log('🔧 Creating/verifying promocodes table...');
        
        // Создаем основную таблицу промокодов
        await pool.query(`
            CREATE TABLE IF NOT EXISTS promocodes (
                id SERIAL PRIMARY KEY,
                code VARCHAR(20) UNIQUE NOT NULL,
                max_uses INTEGER NOT NULL,
                used_count INTEGER DEFAULT 0,
                reward REAL NOT NULL DEFAULT 0,
                expires_at TIMESTAMP,
                is_active BOOLEAN DEFAULT true,
                created_by BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Создаем таблицу активаций
        await pool.query(`
            CREATE TABLE IF NOT EXISTS promocode_activations (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                promocode_id INTEGER NOT NULL,
                activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (promocode_id) REFERENCES promocodes(id)
            )
        `);
        
        
        // Проверяем и добавляем отсутствующие колонки
        const columnsToCheck = [
            {name: 'reward', type: 'REAL', nullable: 'NOT NULL', defaultValue: '0'},
            {name: 'max_uses', type: 'INTEGER', nullable: 'NOT NULL'},
            {name: 'used_count', type: 'INTEGER', nullable: 'DEFAULT 0'},
            {name: 'expires_at', type: 'TIMESTAMP', nullable: 'NULL'},
            {name: 'is_active', type: 'BOOLEAN', nullable: 'DEFAULT true'},
            {name: 'created_by', type: 'BIGINT', nullable: 'NOT NULL'}
        ];
        
        for (const column of columnsToCheck) {
            const columnExists = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'promocodes' AND column_name = $1
                )
            `, [column.name]);
            
            if (!columnExists.rows[0].exists) {
                console.log(`❌ Column ${column.name} missing, adding...`);
                try {
                    await pool.query(`
                        ALTER TABLE promocodes 
                        ADD COLUMN ${column.name} ${column.type} ${column.nullable}
                        ${column.defaultValue ? `DEFAULT ${column.defaultValue}` : ''}
                    `);
                    console.log(`✅ Column ${column.name} added`);
                } catch (addError) {
                    console.log(`⚠️ Could not add column ${column.name}:`, addError.message);
                }
            }
        }
        
        console.log('✅ Promocodes tables created/verified');
    } catch (error) {
        console.error('❌ Error creating promocodes tables:', error);
        throw error;
    }
}

// Создание тестовой заявки на вывод
app.post('/api/test-withdrawal', async (req, res) => {
    try {
        // Создаем тестовую заявку
        const result = await pool.query(`
            INSERT INTO withdrawal_requests (user_id, username, first_name, amount, status) 
            VALUES ($1, $2, $3, $4, 'pending')
            RETURNING *
        `, [123456, 'test_user', 'Test User', 150]);
        
        res.json({
            success: true,
            message: 'Test withdrawal request created',
            request: result.rows[0]
        });
        
    } catch (error) {
        console.error('Test withdrawal error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Инициализируем базу данных при запуске
initDatabase();
// Принудительное создание таблицы withdrawal_requests
async function createWithdrawalTable() {
    try {
        console.log('🔧 Creating withdrawal_requests table...');
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS withdrawal_requests (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                username TEXT,
                first_name TEXT,
                amount REAL NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                completed_by BIGINT
            )
        `);
        
        console.log('✅ withdrawal_requests table created/verified');
    } catch (error) {
        console.error('❌ Error creating withdrawal_requests table:', error);
    }
}

// В server.js в функцию initDatabase добавьте:
async function checkTasksTableStructure() {
    try {
        console.log('🔍 Checking tasks table structure...');
        
        const structure = await pool.query(`
            SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'promocodes' 
ORDER BY ordinal_position;

ALTER TABLE promocodes ADD COLUMN IF NOT EXISTS reward REAL NOT NULL DEFAULT 0;
        `);
        
        console.log('📊 Tasks table structure:', structure.rows);
        
        // Проверяем наличие важных колонок
        const requiredColumns = ['id', 'title', 'description', 'price', 'created_by', 'status'];
        const missingColumns = requiredColumns.filter(col => 
            !structure.rows.find(row => row.column_name === col)
        );
        
        if (missingColumns.length > 0) {
            console.log('❌ Missing columns in tasks table:', missingColumns);
            return false;
        }
        
        console.log('✅ Tasks table structure is OK');
        return true;
        
    } catch (error) {
        console.error('Error checking tasks table structure:', error);
        return false;
    }
}
async function verifyPromocodesTable() {
    try {
        console.log('🔍 Проверка таблицы промокодов...');
        
        // Проверяем существование таблицы
        const tableExists = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'promocodes'
            );
        `);
        
        if (!tableExists.rows[0].exists) {
            console.log('❌ Таблица promocodes не существует, создаем...');
            await createPromocodesTable();
        } else {
            console.log('✅ Таблица promocodes существует');
        }
        
        // Проверяем структуру таблицы
        const structure = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'promocodes' 
            ORDER BY ordinal_position
        `);
        
        console.log('📊 Структура таблицы promocodes:', structure.rows);
        
    } catch (error) {
        console.error('❌ Ошибка проверки таблицы промокодов:', error);
    }
}
// Функция для проверки и исправления структуры таблицы промокодов
async function verifyPromocodesTableStructure() {
    try {
        console.log('🔍 Проверка структуры таблицы promocodes...');
        
        // Проверяем существование всех необходимых колонок
        const columnsToCheck = [
            { name: 'reward', type: 'REAL', nullable: 'NOT NULL', defaultValue: '0' },
            { name: 'max_uses', type: 'INTEGER', nullable: 'NOT NULL' },
            { name: 'used_count', type: 'INTEGER', nullable: 'DEFAULT 0' },
            { name: 'expires_at', type: 'TIMESTAMP', nullable: 'NULL' },
            { name: 'is_active', type: 'BOOLEAN', nullable: 'DEFAULT true' },
            { name: 'created_by', type: 'BIGINT', nullable: 'NOT NULL' }
        ];
        
        for (const column of columnsToCheck) {
            const columnExists = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'promocodes' AND column_name = $1
                )
            `, [column.name]);
            
            if (!columnExists.rows[0].exists) {
                console.log(`❌ Колонка ${column.name} отсутствует, добавляем...`);
                
                try {
                    await pool.query(`
                        ALTER TABLE promocodes 
                        ADD COLUMN ${column.name} ${column.type} ${column.nullable}
                        ${column.defaultValue ? `DEFAULT ${column.defaultValue}` : ''}
                    `);
                    console.log(`✅ Колонка ${column.name} добавлена`);
                } catch (addError) {
                    console.log(`⚠️ Не удалось добавить колонку ${column.name}:`, addError.message);
                }
            } else {
                console.log(`✅ Колонка ${column.name} существует`);
            }
        }
        
        console.log('✅ Структура таблицы promocodes проверена');
    } catch (error) {
        console.error('❌ Ошибка проверки структуры таблицы:', error);
    }
}
// Функция для принудительного обновления структуры таблицы
async function fixWithdrawalTable() {
    try {
        console.log('🔧 Проверка и исправление структуры таблицы withdrawal_requests...');
        
        // Проверяем существование таблицы
        const tableExists = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'withdrawal_requests'
            );
        `);
        
        if (!tableExists.rows[0].exists) {
            console.log('❌ Таблица withdrawal_requests не существует, создаем...');
            await pool.query(`
                CREATE TABLE withdrawal_requests (
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    username TEXT,
                    first_name TEXT,
                    amount REAL NOT NULL,
                    status TEXT DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP,
                    completed_by BIGINT
                )
            `);
            console.log('✅ Таблица создана');
            return;
        }
        
        // Проверяем и добавляем отсутствующие колонки
        const columnsToCheck = [
            {name: 'username', type: 'TEXT'},
            {name: 'first_name', type: 'TEXT'},
            {name: 'completed_at', type: 'TIMESTAMP'},
            {name: 'completed_by', type: 'BIGINT'}
        ];
        
        for (const column of columnsToCheck) {
            const columnExists = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'withdrawal_requests' AND column_name = $1
                );
            `, [column.name]);
            
            if (!columnExists.rows[0].exists) {
                console.log(`❌ Колонка ${column.name} отсутствует, добавляем...`);
                
                try {
                    await pool.query(`ALTER TABLE withdrawal_requests ADD COLUMN ${column.name} ${column.type}`);
                    console.log(`✅ Колонка ${column.name} добавлена`);
                } catch (addError) {
                    console.log(`⚠️ Не удалось добавить колонку ${column.name}:`, addError.message);
                }
            } else {
                console.log(`✅ Колонка ${column.name} существует`);
            }
        }
        
        console.log('✅ Структура таблицы проверена и исправлена');
    } catch (error) {
        console.error('❌ Ошибка при исправлении таблицы:', error);
    }
}

// Вызовите эту функцию при инициализации сервера
fixWithdrawalTable();

// 🔥 ПОЛНАЯ ОБРАБОТКА РЕФЕРАЛОВ ПРИ РЕГИСТРАЦИИ
bot.onText(/\/start(.+)?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const referralCode = match[1] ? match[1].trim() : null;
    
    console.log('🎯 Start command received:', { userId, referralCode });
    
    try {
        const userData = {
            id: userId,
            firstName: msg.from.first_name || 'Пользователь',
            lastName: msg.from.last_name || '',
            username: msg.from.username || `user_${userId}`
        };
        
        let referredBy = null;
        let referrerName = '';
        let referralBonusGiven = false;
        
        // 🔥 ОТСЛЕЖИВАЕМ КОНВЕРСИЮ ЕСЛИ ЕСТЬ РЕФЕРАЛЬНЫЙ КОД
        if (referralCode) {
            try {
                // Отправляем запрос на отслеживание конверсии
                await fetch(`${APP_URL}/api/referral-links/track-conversion`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        code: referralCode,
                        userId: userId
                    })
                });
                
                console.log(`✅ Конверсия зарегистрирована для ссылки: ${referralCode}`);
            } catch (trackError) {
                console.log('⚠️ Ошибка отслеживания конверсии:', trackError.message);
            }
        }
        // Генерируем реферальный код для пользователя
        const userReferralCode = `ref_${userId}`;
        
        // 🔥 СОХРАНЯЕМ/ОБНОВЛЯЕМ ПОЛЬЗОВАТЕЛЯ С РЕФЕРАЛЬНОЙ ИНФОРМАЦИЕЙ
        const userResult = await pool.query(`
            INSERT INTO user_profiles 
            (user_id, username, first_name, last_name, referral_code, referred_by, is_first_login) 
            VALUES ($1, $2, $3, $4, $5, $6, true)
            ON CONFLICT (user_id) 
            DO UPDATE SET 
                username = EXCLUDED.username,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                referral_code = COALESCE(user_profiles.referral_code, EXCLUDED.referral_code),
                referred_by = COALESCE(user_profiles.referred_by, EXCLUDED.referred_by),
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [
            userId, 
            userData.username,
            userData.firstName,
            userData.lastName,
            userReferralCode,
            referredBy
        ]);
        
        const userProfile = userResult.rows[0];
        
        // 🔥 ЕСЛИ ЭТО ПЕРВЫЙ ВХОД И ПОЛЬЗОВАТЕЛЬ ПРИШЕЛ ПО РЕФЕРАЛЬНОЙ ССЫЛКЕ
        if (userProfile.is_first_login && referredBy) {
            console.log(`🎉 Начисляем реферальные бонусы за первую регистрацию`);
            
            // Начинаем транзакцию для безопасного начисления бонусов
            const client = await pool.connect();
            
            try {
                await client.query('BEGIN');
                
                    // 1. Даем 2 звезды новому пользователю за переход по ссылке
    await client.query(`
        UPDATE user_profiles 
        SET balance = COALESCE(balance, 0) + 2,
            is_first_login = false
        WHERE user_id = $1
    `, [userId]);
    
    // 2. Обновляем счетчик рефералов у пригласившего
    await client.query(`
        UPDATE user_profiles 
        SET referral_count = COALESCE(referral_count, 0) + 1
        WHERE user_id = $1
    `, [referredBy]);
                
                await client.query('COMMIT');
                
                referralBonusGiven = true;
                
                console.log(`✅ Реферальный бонус: пользователь ${userId} получил 2⭐ за переход по ссылке`);
                
                // Отправляем уведомление пригласившему
                if (bot) {
                    try {
                        await bot.sendMessage(
                            referredBy,
                            `🎉 <b>Новый реферал!</b>\n\n` +
                            `Пользователь ${userData.firstName} (@${userData.username}) перешел по вашей ссылке!\n\n` +
                            `👤 Реферал получил: <b>2⭐</b> за регистрацию\n` +
                            `💫 Теперь вы будете получать 10% от всех его заработков! 🚀`,
                            { parse_mode: 'HTML' }
                        );
                    } catch (botError) {
                        console.log('Не удалось отправить уведомление рефереру:', botError.message);
                    }
                }
                
            } catch (transactionError) {
                await client.query('ROLLBACK');
                console.error('❌ Ошибка транзакции реферального бонуса:', transactionError);
            } finally {
                client.release();
            }
        }
        
        // 🔥 ОБНОВЛЯЕМ ДАННЫЕ ПОЛЬЗОВАТЕЛЯ ПОСЛЕ НАЧИСЛЕНИЯ БОНУСОВ
        const updatedUser = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        const finalUserProfile = updatedUser.rows[0];
        
        // 🔥 ФОРМИРУЕМ ПРИВЕТСТВЕННОЕ СООБЩЕНИЕ
        let welcomeMessage = `👋 <b>Добро пожаловать в LinkGold, ${userData.firstName}!</b>\n\n`;
        
        if (referralBonusGiven) {
            welcomeMessage += `🎁 <b>Вы получили 2⭐ за регистрацию по реферальной ссылке!</b>\n`;
            welcomeMessage += `💫 Ваш баланс: <b>${finalUserProfile.balance || 0}⭐</b>\n\n`;
        }
        
        welcomeMessage += `🎯 <b>Как начать зарабатывать:</b>\n`;
        welcomeMessage += `1. Выберите задание из списка\n`;
        welcomeMessage += `2. Выполните его по инструкции\n`;
        welcomeMessage += `3. Отправьте скриншот на проверку\n`;
        welcomeMessage += `4. Получите оплату после одобрения\n\n`;
        
        welcomeMessage += `🎁 <b>Реферальная система:</b>\n`;
        welcomeMessage += `• Вы получаете <b>90%</b> от своего заработка\n`;
        welcomeMessage += `• Пригласивший получает <b>10%</b> от вашего заработка\n`;
        welcomeMessage += `• Автоматически с каждого задания\n\n`;
        
        welcomeMessage += `🔗 <b>Ваша реферальная ссылка:</b>\n`;
        welcomeMessage += `<code>https://t.me/LinkGoldMoney_bot?start=${userReferralCode}</code>`;
        
        // Отправляем сообщение пользователю
        await bot.sendMessage(
            chatId,
            welcomeMessage,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '📢 Наш канал',
                                url: 'https://t.me/LinkGoldChannel1'
                            }
                        ],
                        [
                            {
                                text: '👥 Поделиться с друзьями',
                                url: `https://t.me/share/url?url=https://t.me/LinkGoldMoney_bot?start=${userReferralCode}&text=Присоединяйся к LinkGold и начинай зарабатывать Telegram Stars! 🚀 Получи 2⭐ за регистрацию!`
                            }
                        ],
                        [
                            {
                                text: '💰 Мой баланс',
                                callback_data: 'balance'
                            },
                            {
                                text: '👥 Рефералы', 
                                callback_data: 'referral'
                            }
                        ]
                    ]
                }
            }
        );
        
        console.log(`✅ Пользователь ${userId} успешно зарегистрирован`, {
            referredBy: referredBy,
            bonusGiven: referralBonusGiven,
            referralCode: userReferralCode
        });
        
    } catch (error) {
        console.error('❌ Start command error:', error);
        await bot.sendMessage(
            chatId, 
            '❌ Произошла ошибка при регистрации. Попробуйте позже.'
        );
    }
});
app.post('/api/user/auth', async (req, res) => {
    const { user, referralCode } = req.body;
    
    if (!user) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields'
        });
    }
    
    try {
        const isMainAdmin = parseInt(user.id) === ADMIN_ID;
        
        // Генерируем реферальный код для пользователя
        const userReferralCode = `ref_${user.id}_${Date.now()}`;
        
    let referredBy = null;
    
    // 🔥 ВАЖНО: Сохраняем реферальный код если он есть
    if (referralCode) {
        const cleanReferralCode = referralCode.replace('ref_', '');
        const referrerResult = await pool.query(
            'SELECT user_id FROM user_profiles WHERE referral_code = $1',
            [cleanReferralCode]
        );
        
        if (referrerResult.rows.length > 0) {
            referredBy = referrerResult.rows[0].user_id;
            console.log(`🎯 Пользователь пришел по реферальной ссылки от: ${referredBy}`);
        }
    }
        
        const result = await pool.query(`
            INSERT INTO user_profiles 
            (user_id, username, first_name, last_name, photo_url, is_admin, referral_code, referred_by, is_first_login) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
            ON CONFLICT (user_id) 
            DO UPDATE SET 
                username = EXCLUDED.username,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                photo_url = EXCLUDED.photo_url,
                is_admin = COALESCE(user_profiles.is_admin, EXCLUDED.is_admin),
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [
            user.id, 
            user.username || `user_${user.id}`,
            user.first_name || 'Пользователь',
            user.last_name || '',
            user.photo_url || '',
            isMainAdmin,
            userReferralCode,
            referredBy
        ]);
        
        const userProfile = result.rows[0];
        
        // 🔥 ЕСЛИ ЭТО ПЕРВЫЙ ВХОД И ЕСТЬ РЕФЕРАЛ
        if (userProfile.is_first_login && referredBy) {
            // Даем 2 звезды новому пользователю за переход по ссылке
            await pool.query(`
                UPDATE user_profiles 
                SET balance = COALESCE(balance, 0) + 2,
                    is_first_login = false
                WHERE user_id = $1
            `, [user.id]);
            
            // Обновляем счетчик рефералов у пригласившего
            await pool.query(`
                UPDATE user_profiles 
                SET referral_count = COALESCE(referral_count, 0) + 1
                WHERE user_id = $1
            `, [referredBy]);
            
            referralBonusGiven = true;
            
            console.log(`🎉 Web реферальный бонус: пользователь ${user.id} получил 2⭐ за переход по ссылке`);
        }
        
        // Обновляем данные пользователя после начисления бонусов
        const updatedUser = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [user.id]
        );
        
        res.json({
            success: true,
            user: updatedUser.rows[0],
            referralBonusGiven: referralBonusGiven
        });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
app.get('/api/debug/referral-system', async (req, res) => {
    try {
        // Проверяем настройки реферальной системы
        const referralStats = await pool.query(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN referred_by IS NOT NULL THEN 1 END) as referred_users,
                COUNT(CASE WHEN balance >= 2 AND referred_by IS NOT NULL THEN 1 END) as users_with_bonus,
                SUM(CASE WHEN referred_by IS NOT NULL THEN balance ELSE 0 END) as total_referral_balance,
                AVG(CASE WHEN referred_by IS NOT NULL THEN balance ELSE 0 END) as avg_referral_balance
            FROM user_profiles
        `);
        
        // Проверяем последние реферальные начисления
        const recentReferrals = await pool.query(`
            SELECT up.user_id, up.balance, up.created_at, 
                   ref.username as referrer_username
            FROM user_profiles up
            LEFT JOIN user_profiles ref ON up.referred_by = ref.user_id
            WHERE up.referred_by IS NOT NULL
            ORDER BY up.created_at DESC
            LIMIT 10
        `);
        
        res.json({
            success: true,
            stats: referralStats.rows[0],
            recentReferrals: recentReferrals.rows,
            system: {
                bonus_for_new_user: "2⭐",
                income_distribution: "90% user / 10% referrer",
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Referral system debug error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Проверка реферальных данных пользователя
app.get('/api/user/:userId/referral-info', async (req, res) => {
    const userId = req.params.userId;
    
    try {
        const result = await pool.query(`
            SELECT 
                up.user_id,
                up.username,
                up.first_name,
                up.referred_by,
                up.referral_earned,
                ref.username as referrer_username,
                ref.first_name as referrer_name
            FROM user_profiles up
            LEFT JOIN user_profiles ref ON up.referred_by = ref.user_id
            WHERE up.user_id = $1
        `, [userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const user = result.rows[0];
        
        res.json({
            success: true,
            user: user,
            hasReferrer: !!user.referred_by,
            referrerInfo: user.referred_by ? {
                id: user.referred_by,
                username: user.referrer_username,
                name: user.referrer_name
            } : null
        });
        
    } catch (error) {
        console.error('Get referral info error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error'
        });
    }
});

// Тестовая команда для проверки отправки уведомлений
bot.onText(/\/testnotify/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Только для главного админа
    if (parseInt(userId) !== ADMIN_ID) {
        return await bot.sendMessage(
            chatId,
            '❌ У вас нет прав для тестирования уведомлений.'
        );
    }
    
    try {
        // Простая проверка - отправляем сообщение самому себе
        await bot.sendMessage(
            chatId,
            '✅ Бот работает корректно! Вы можете использовать /notify для рассылки.'
        );
        
        // Проверяем количество пользователей
        const usersCount = await pool.query(
            'SELECT COUNT(*) FROM user_profiles WHERE user_id != $1',
            [ADMIN_ID]
        );
        
        await bot.sendMessage(
            chatId,
            `📊 Всего пользователей для рассылки: ${parseInt(usersCount.rows[0].count)}`
        );
        
    } catch (error) {
        console.error('Test notify error:', error);
        await bot.sendMessage(
            chatId,
            `❌ Ошибка тестирования: ${error.message}`
        );
    }
});

// Обработчик команды /notify для главного админа
// Обработчик команды /notify для главного админа
bot.onText(/\/notify(.+)?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageText = match[1] ? match[1].trim() : null;
    
    console.log('📢 Notify command received:', { userId, messageText });
    
    // Проверяем что это именно главный админ
    if (parseInt(userId) !== ADMIN_ID) {
        return await bot.sendMessage(
            chatId,
            '❌ У вас нет прав для отправки уведомлений. Эта команда доступна только главному администратору.'
        );
    }
    
    if (!messageText) {
        return await bot.sendMessage(
            chatId,
            '❌ Использование: /notify [сообщение]\n\nПример: /notify Всем привет! Новое обновление уже доступно!'
        );
    }
    
    try {
        // Показываем пользователю, что началась отправка
        const processingMsg = await bot.sendMessage(
            chatId,
            '🔄 Начинаю отправку уведомлений всем пользователям...'
        );
        
        // 🔥 ИСПРАВЛЕНИЕ: Получаем всех пользователей и отправляем напрямую через бота
        const usersResult = await pool.query(
            'SELECT user_id FROM user_profiles WHERE user_id != $1',
            [ADMIN_ID]
        );
        
        const users = usersResult.rows;
        console.log(`📨 Найдено ${users.length} пользователей для отправки уведомлений`);
        
        if (users.length === 0) {
            return await bot.editMessageText(
                '❌ Нет пользователей для отправки уведомлений',
                {
                    chat_id: chatId,
                    message_id: processingMsg.message_id
                }
            );
        }
        
        let successCount = 0;
        let failCount = 0;
        const failedUsers = [];
        
        // Сохраняем запись об уведомлении
        const notificationRecord = await pool.query(`
            INSERT INTO admin_notifications (admin_id, message, sent_count, failed_count) 
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [userId, messageText, 0, 0]);
        
        // Отправляем уведомление каждому пользователю
        for (const user of users) {
            try {
                await bot.sendMessage(
                    user.user_id,
                    `📢 <b>Уведомление от LinkGold:</b>\n\n${messageText}`,
                    { parse_mode: 'HTML' }
                );
                successCount++;
                
                // Обновляем прогресс каждые 10 отправок
                if (successCount % 10 === 0) {
                    await bot.editMessageText(
                        `🔄 Отправка уведомлений...\n\nПрогресс: ${successCount}/${users.length}`,
                        {
                            chat_id: chatId,
                            message_id: processingMsg.message_id
                        }
                    );
                }
                
                // Задержка чтобы не превысить лимиты Telegram (30 сообщений в секунду)
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.error(`❌ Ошибка отправки пользователю ${user.user_id}:`, error.message);
                failCount++;
                failedUsers.push({
                    user_id: user.user_id,
                    error: error.message
                });
                
                // Если ошибка связана с блокировкой бота, пропускаем пользователя
                if (error.response && error.response.statusCode === 403) {
                    console.log(`🚫 Бот заблокирован пользователем ${user.user_id}`);
                }
            }
        }
        
        // Обновляем статистику отправки
        await pool.query(`
            UPDATE admin_notifications 
            SET sent_count = $1, failed_count = $2 
            WHERE id = $3
        `, [successCount, failCount, notificationRecord.rows[0].id]);
        
        console.log(`✅ Уведомления отправлены: ${successCount} успешно, ${failCount} с ошибкой`);
        
        // Формируем финальное сообщение со статистикой
        let finalMessage = `✅ <b>Уведомление отправлено!</b>\n\n`;
        finalMessage += `📊 <b>Статистика:</b>\n`;
        finalMessage += `• Всего пользователей: ${users.length}\n`;
        finalMessage += `• Успешно отправлено: ${successCount}\n`;
        finalMessage += `• С ошибкой: ${failCount}\n\n`;
        finalMessage += `💬 <b>Ваше сообщение:</b>\n${messageText}`;
        
        // Показываем ошибки если есть
        if (failedUsers.length > 0) {
            finalMessage += `\n\n❌ <b>Ошибки отправки (первые 5):</b>\n`;
            failedUsers.slice(0, 5).forEach((failed, index) => {
                finalMessage += `${index + 1}. ID ${failed.user_id}: ${failed.error}\n`;
            });
            
            if (failedUsers.length > 5) {
                finalMessage += `... и еще ${failedUsers.length - 5} ошибок`;
            }
        }
        
        await bot.editMessageText(
            finalMessage,
            {
                chat_id: chatId,
                message_id: processingMsg.message_id,
                parse_mode: 'HTML'
            }
        );
        
    } catch (error) {
        console.error('Notify command error:', error);
        
        // Пытаемся отправить сообщение об ошибке
        try {
            await bot.sendMessage(
                chatId,
                `❌ Произошла ошибка при отправке уведомлений: ${error.message}`
            );
        } catch (e) {
            console.error('Even error message failed:', e);
        }
    }
});

// Обработчик ошибок бота
if (bot) {
    bot.on('polling_error', (error) => {
        console.error('❌ Bot polling error:', error);
    });
    
    bot.on('webhook_error', (error) => {
        console.error('❌ Bot webhook error:', error);
    });
}
// Получение детальной статистики по ссылке
app.get('/api/admin/links/:linkId/stats', async (req, res) => {
    const { linkId } = req.params;
    const { adminId } = req.query;
    
    try {
        // Проверка прав администратора
        const isAdmin = await checkAdminAccess(adminId);
        if (!isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        // Основная статистика ссылки
        const linkStats = await pool.query(`
            SELECT * FROM referral_links WHERE id = $1
        `, [linkId]);
        
        if (linkStats.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Ссылка не найдена'
            });
        }
        
        // Статистика по дням
        const dailyStats = await pool.query(`
            SELECT 
                DATE(clicked_at) as date,
                COUNT(*) as total_clicks,
                COUNT(DISTINCT ip_address) as unique_clicks
            FROM referral_link_clicks 
            WHERE link_id = $1 
            GROUP BY DATE(clicked_at)
            ORDER BY date DESC
            LIMIT 30
        `, [linkId]);
        
        // Последние клики
        const recentClicks = await pool.query(`
            SELECT 
                rlc.*,
                up.username,
                up.first_name
            FROM referral_link_clicks rlc
            LEFT JOIN user_profiles up ON rlc.user_id = up.user_id
            WHERE rlc.link_id = $1
            ORDER BY rlc.clicked_at DESC
            LIMIT 20
        `, [linkId]);
        
        res.json({
            success: true,
            link: linkStats.rows[0],
            dailyStats: dailyStats.rows,
            recentClicks: recentClicks.rows
        });
        
    } catch (error) {
        console.error('Get link stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
// Получение истории отправленных уведомлений
app.get('/api/admin/notification-history', async (req, res) => {
    const { adminId } = req.query;
    
    // Только для главного админа
    if (parseInt(adminId) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен'
        });
    }
    
    try {
        const result = await pool.query(`
            SELECT * FROM admin_notifications 
            ORDER BY sent_at DESC 
            LIMIT 50
        `);
        
        res.json({
            success: true,
            notifications: result.rows
        });
    } catch (error) {
        console.error('Get notification history error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Команда для проверки статистики пользователей перед отправкой
bot.onText(/\/notifystats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Только для главного админа
    if (parseInt(userId) !== ADMIN_ID) {
        return await bot.sendMessage(
            chatId,
            '❌ У вас нет прав для просмотра статистики уведомлений.'
        );
    }
    
    try {
        const usersCount = await pool.query(
            'SELECT COUNT(*) FROM user_profiles WHERE user_id != $1',
            [ADMIN_ID]
        );
        
        const notificationsCount = await pool.query(
            'SELECT COUNT(*) FROM admin_notifications'
        );
        
        const lastNotification = await pool.query(
            'SELECT * FROM admin_notifications ORDER BY sent_at DESC LIMIT 1'
        );
        
        let message = `📊 <b>Статистика для рассылки уведомлений</b>\n\n`;
        message += `👥 <b>Всего пользователей:</b> ${parseInt(usersCount.rows[0].count)}\n`;
        message += `📨 <b>Всего отправлено уведомлений:</b> ${parseInt(notificationsCount.rows[0].count)}\n`;
        
        if (lastNotification.rows.length > 0) {
            const last = lastNotification.rows[0];
            message += `\n🕒 <b>Последнее уведомление:</b>\n`;
            message += `• Дата: ${new Date(last.sent_at).toLocaleString('ru-RU')}\n`;
            message += `• Отправлено: ${last.sent_count} пользователям\n`;
            message += `• Ошибок: ${last.failed_count}\n`;
        }
        
        message += `\n💡 <b>Используйте команду:</b>\n<code>/notify [ваше сообщение]</code>`;
        
        await bot.sendMessage(
            chatId,
            message,
            { parse_mode: 'HTML' }
        );
        
    } catch (error) {
        console.error('Notification stats error:', error);
        await bot.sendMessage(
            chatId,
            '❌ Ошибка при получении статистики.'
        );
    }
});

bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Проверяем права администратора
    const isAdmin = await checkAdminAccess(userId);
    if (!isAdmin) {
        return await bot.sendMessage(
            chatId,
            '❌ У вас нет прав для просмотра статистики.'
        );
    }
    
    try {
        const response = await fetch(`${APP_URL}/api/admin/users-detailed-stats?adminId=${userId}&limit=5`);
        const result = await response.json();
        
        if (result.success) {
            const stats = result.stats.main;
            const activity = result.stats.activity;
            
            let message = `📊 <b>Детальная статистика LinkGold</b>\n\n`;
            message += `<b>👥 Пользователи:</b>\n`;
            message += `• Всего: <b>${stats.total_users}</b>\n`;
            message += `• Админов: <b>${stats.admin_users}</b>\n`;
            message += `• С балансом: <b>${stats.users_with_balance}</b>\n`;
            message += `• Могут выводить: <b>${stats.users_can_withdraw}</b>\n\n`;
            
            message += `<b>💰 Финансы:</b>\n`;
            message += `• Общий баланс: <b>${parseFloat(stats.total_balance).toFixed(2)}⭐</b>\n`;
            message += `• Средний баланс: <b>${parseFloat(stats.avg_balance).toFixed(2)}⭐</b>\n`;
            message += `• Макс. баланс: <b>${parseFloat(stats.max_balance).toFixed(2)}⭐</b>\n\n`;
            
            message += `<b>🎯 Активность:</b>\n`;
            message += `• Выполнено заданий: <b>${activity.completed_tasks || 0}</b>\n`;
            message += `• На проверке: <b>${activity.pending_tasks || 0}</b>\n`;
            message += `• Заработано: <b>${parseFloat(activity.total_earned_from_tasks || 0).toFixed(2)}⭐</b>\n\n`;
            
            message += `<b>👥 Рефералы:</b>\n`;
            message += `• Всего приглашено: <b>${stats.total_referrals}</b>\n`;
            message += `• Заработано: <b>${parseFloat(stats.total_referral_earnings).toFixed(2)}⭐</b>`;
            
            await bot.sendMessage(
                chatId,
                message,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '📊 Полная статистика',
                                    url: `${APP_URL}/admin.html?tab=users`
                                }
                            ],
                            [
                                {
                                    text: '📢 Отправить уведомление',
                                    callback_data: 'send_notification'
                                }
                            ]
                        ]
                    }
                }
            );
        } else {
            throw new Error(result.error);
        }
        
    } catch (error) {
        console.error('Stats command error:', error);
        await bot.sendMessage(
            chatId,
            '❌ Ошибка при получении статистики.'
        );
    }
});

// Команда для поиска пользователей по юзернейму
bot.onText(/\/search_user (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const searchUsername = match[1].trim();
    
    console.log('🔍 Search user command:', { userId, searchUsername });
    
    // Проверяем права администратора
    const isAdmin = await checkAdminAccess(userId);
    if (!isAdmin) {
        return await bot.sendMessage(
            chatId,
            '❌ У вас нет прав для поиска пользователей.'
        );
    }
    
    try {
        // Ищем пользователя по юзернейму
        const userResult = await pool.query(`
            SELECT 
                up.user_id,
                up.username,
                up.first_name,
                up.last_name,
                up.balance,
                up.is_admin,
                up.created_at,
                up.referral_count,
                up.referral_earned,
                COUNT(ut.id) as total_tasks,
                COUNT(CASE WHEN ut.status = 'completed' THEN 1 END) as completed_tasks,
                COUNT(CASE WHEN ut.status = 'rejected' THEN 1 END) as rejected_tasks,
                COUNT(CASE WHEN ut.status = 'pending_review' THEN 1 END) as pending_tasks
            FROM user_profiles up
            LEFT JOIN user_tasks ut ON up.user_id = ut.user_id
            WHERE up.username ILIKE $1 OR up.user_id::text = $1
            GROUP BY up.user_id
            LIMIT 1
        `, [`%${searchUsername}%`]);
        
        if (userResult.rows.length === 0) {
            return await bot.sendMessage(
                chatId,
                `❌ Пользователь с юзернеймом "${searchUsername}" не найден.`
            );
        }
        
        const user = userResult.rows[0];
        await sendUserInfo(chatId, user);
        
    } catch (error) {
        console.error('Search user error:', error);
        await bot.sendMessage(
            chatId,
            '❌ Произошла ошибка при поиске пользователя.'
        );
    }
});

// Команда для поиска по ID пользователя
bot.onText(/\/user (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const searchId = match[1].trim();
    
    // Проверяем права администратора
    const isAdmin = await checkAdminAccess(userId);
    if (!isAdmin) {
        return await bot.sendMessage(
            chatId,
            '❌ У вас нет прав для поиска пользователей.'
        );
    }
    
    try {
        const userResult = await pool.query(`
            SELECT 
                up.user_id,
                up.username,
                up.first_name,
                up.last_name,
                up.balance,
                up.is_admin,
                up.created_at,
                up.referral_count,
                up.referral_earned,
                COUNT(ut.id) as total_tasks,
                COUNT(CASE WHEN ut.status = 'completed' THEN 1 END) as completed_tasks,
                COUNT(CASE WHEN ut.status = 'rejected' THEN 1 END) as rejected_tasks,
                COUNT(CASE WHEN ut.status = 'pending_review' THEN 1 END) as pending_tasks
            FROM user_profiles up
            LEFT JOIN user_tasks ut ON up.user_id = ut.user_id
            WHERE up.user_id = $1
            GROUP BY up.user_id
        `, [searchId]);
        
        if (userResult.rows.length === 0) {
            return await bot.sendMessage(
                chatId,
                `❌ Пользователь с ID "${searchId}" не найден.`
            );
        }
        
        const user = userResult.rows[0];
        await sendUserInfo(chatId, user);
        
    } catch (error) {
        console.error('User search error:', error);
        await bot.sendMessage(
            chatId,
            '❌ Произошла ошибка при поиске пользователя.'
        );
    }
});
// 🔍 ПОИСК ПОЛЬЗОВАТЕЛЕЙ ПО ЮЗЕРНЕЙМУ - УЛУЧШЕННАЯ ВЕРСИЯ
bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const searchQuery = match[1].trim();
    
    console.log('🔍 Search command received:', { userId, searchQuery });
    
    // Проверяем права администратора
    const isAdmin = await checkAdminAccess(userId);
    if (!isAdmin) {
        return await bot.sendMessage(
            chatId,
            '❌ У вас нет прав для поиска пользователей.'
        );
    }
    
    try {
        // Ищем пользователя по юзернейму или ID
        const userResult = await pool.query(`
            SELECT 
                up.user_id,
                up.username,
                up.first_name,
                up.last_name,
                up.balance,
                up.is_admin,
                up.created_at,
                up.referral_count,
                up.referral_earned,
                -- Статистика заданий
                COUNT(ut.id) as total_tasks,
                COUNT(CASE WHEN ut.status = 'completed' THEN 1 END) as completed_tasks,
                COUNT(CASE WHEN ut.status = 'rejected' THEN 1 END) as rejected_tasks,
                COUNT(CASE WHEN ut.status = 'pending_review' THEN 1 END) as pending_tasks,
                -- Статистика выплат
                COUNT(wr.id) as withdrawal_requests,
                COUNT(CASE WHEN wr.status = 'completed' THEN 1 END) as completed_withdrawals,
                COALESCE(SUM(CASE WHEN wr.status = 'completed' THEN wr.amount ELSE 0 END), 0) as total_withdrawn,
                -- Информация о реферере
                ref.username as referrer_username,
                ref.first_name as referrer_name
            FROM user_profiles up
            LEFT JOIN user_tasks ut ON up.user_id = ut.user_id
            LEFT JOIN withdrawal_requests wr ON up.user_id = wr.user_id
            LEFT JOIN user_profiles ref ON up.referred_by = ref.user_id
            WHERE up.username ILIKE $1 OR up.user_id::text = $1 OR up.first_name ILIKE $1
            GROUP BY up.user_id, ref.username, ref.first_name
            ORDER BY 
                CASE 
                    WHEN up.username = $1 THEN 1
                    WHEN up.user_id::text = $1 THEN 2
                    ELSE 3
                END,
                up.created_at DESC
            LIMIT 10
        `, [`%${searchQuery}%`]);
        
        if (userResult.rows.length === 0) {
            return await bot.sendMessage(
                chatId,
                `❌ Пользователи по запросу "${searchQuery}" не найдены.\n\nПопробуйте:\n• Юзернейм (без @)\n• ID пользователя\n• Имя`
            );
        }
        
        if (userResult.rows.length === 1) {
            // Если найден один пользователь - показываем детальную информацию
            const user = userResult.rows[0];
            await sendUserManagementPanel(chatId, user);
        } else {
            // Если найдено несколько пользователей - показываем список
            await sendUsersList(chatId, userResult.rows, searchQuery);
        }
        
    } catch (error) {
        console.error('❌ Search users error:', error);
        await bot.sendMessage(
            chatId,
            '❌ Произошла ошибка при поиске пользователей.'
        );
    }
});

// 📋 ОТПРАВКА СПИСКА ПОЛЬЗОВАТЕЛЕЙ
async function sendUsersList(chatId, users, searchQuery) {
    let messageText = `🔍 <b>Найдено пользователей: ${users.length}</b>\n\n`;
    
    users.forEach((user, index) => {
        const userName = user.first_name + (user.last_name ? ` ${user.last_name}` : '');
        const userStatus = user.is_admin ? '👑' : '👤';
        const balance = user.balance || 0;
        
        messageText += `${index + 1}. ${userStatus} <b>${userName}</b>\n`;
        messageText += `   👤 @${user.username || 'нет юзернейма'}\n`;
        messageText += `   🆔 <code>${user.user_id}</code>\n`;
        messageText += `   💫 Баланс: <b>${balance}⭐</b>\n`;
        messageText += `   📅 Регистрация: ${new Date(user.created_at).toLocaleDateString('ru-RU')}\n\n`;
    });
    
    messageText += `💡 <b>Выберите пользователя для управления:</b>`;
    
    const keyboard = {
        inline_keyboard: users.map(user => [
            {
                text: `${user.first_name} (@${user.username || user.user_id})`,
                callback_data: `manage_user_${user.user_id}`
            }
        ])
    };
    
    // Добавляем кнопку "Новый поиск"
    keyboard.inline_keyboard.push([
        {
            text: '🔍 Новый поиск',
            callback_data: 'new_search'
        }
    ]);
    
    await bot.sendMessage(
        chatId,
        messageText,
        {
            parse_mode: 'HTML',
            reply_markup: keyboard
        }
    );
}

// 🎛️ ПАНЕЛЬ УПРАВЛЕНИЯ ПОЛЬЗОВАТЕЛЕМ
async function sendUserManagementPanel(chatId, user) {
    const userName = user.first_name + (user.last_name ? ` ${user.last_name}` : '');
    const userStatus = user.is_admin ? '👑 Администратор' : '👤 Пользователь';
    const registrationDate = new Date(user.created_at).toLocaleDateString('ru-RU');
    const totalEarned = (user.balance || 0) + (user.total_withdrawn || 0);
    
    const messageText = `
👤 <b>ПАНЕЛЬ УПРАВЛЕНИЯ ПОЛЬЗОВАТЕЛЕМ</b>

<b>Основная информация:</b>
🆔 ID: <code>${user.user_id}</code>
👤 Имя: <b>${userName}</b>
📧 Юзернейм: @${user.username || 'не указан'}
🎭 Статус: ${userStatus}
📅 Регистрация: ${registrationDate}

💰 <b>Финансы:</b>
💫 Текущий баланс: <b>${user.balance || 0}⭐</b>
🏦 Всего выведено: <b>${user.total_withdrawn || 0}⭐</b>
💸 Всего заработано: <b>${totalEarned}⭐</b>

📊 <b>Статистика заданий:</b>
✅ Выполнено: <b>${user.completed_tasks || 0}</b>
❌ Отклонено: <b>${user.rejected_tasks || 0}</b>
⏳ На проверке: <b>${user.pending_tasks || 0}</b>
📋 Всего заданий: <b>${user.total_tasks || 0}</b>

👥 <b>Реферальная система:</b>
👤 Приглашено: <b>${user.referral_count || 0} чел.</b>
💫 Заработано: <b>${user.referral_earned || 0}⭐</b>
🎯 Пригласил: ${user.referrer_username ? `@${user.referrer_username}` : 'нет'}
    `.trim();

    const keyboard = {
        inline_keyboard: [
            // Первый ряд: Управление балансом
            [
                {
                    text: '💰 Управление балансом',
                    callback_data: `balance_menu_${user.user_id}`
                },
                {
                    text: '🎭 Права доступа',
                    callback_data: `admin_toggle_${user.user_id}`
                }
            ],
            // Второй ряд: Статистика и действия
            [
                {
                    text: '📊 Детальная статистика',
                    callback_data: `user_stats_${user.user_id}`
                },
                {
                    text: '🔄 Обновить',
                    callback_data: `refresh_user_${user.user_id}`
                }
            ],
            // Третий ряд: Блокировка и выплаты
            [
                {
                    text: user.balance > 0 ? '💸 Выплаты' : '💸 История выплат',
                    callback_data: `withdrawal_info_${user.user_id}`
                },
                {
                    text: '🚫 Заблокировать',
                    callback_data: `block_user_${user.user_id}`
                }
            ],
            // Четвертый ряд: Навигация
            [
                {
                    text: '🔍 Новый поиск',
                    callback_data: 'new_search'
                },
                {
                    text: '📋 Список пользователей',
                    callback_data: 'users_list'
                }
            ]
        ]
    };

    await bot.sendMessage(
        chatId,
        messageText,
        {
            parse_mode: 'HTML',
            reply_markup: keyboard
        }
    );
}

// 💰 МЕНЮ УПРАВЛЕНИЯ БАЛАНСОМ
async function showBalanceManagement(chatId, adminId, targetUserId, messageId) {
    try {
        const userResult = await pool.query(
            'SELECT username, first_name, balance FROM user_profiles WHERE user_id = $1',
            [targetUserId]
        );
        
        if (userResult.rows.length === 0) {
            return await bot.editMessageText(
                '❌ Пользователь не найден',
                { chat_id: chatId, message_id: messageId }
            );
        }
        
        const user = userResult.rows[0];
        const currentBalance = user.balance || 0;
        
        const messageText = `
💰 <b>УПРАВЛЕНИЕ БАЛАНСОМ</b>

👤 Пользователь: ${user.first_name} (@${user.username})
💫 Текущий баланс: <b>${currentBalance}⭐</b>

<b>Быстрые действия:</b>
        `.trim();
        
        const keyboard = {
            inline_keyboard: [
                // Пополнение счета
                [
                    { text: '➕ 50⭐', callback_data: `balance_add_${targetUserId}_50` },
                    { text: '➕ 100⭐', callback_data: `balance_add_${targetUserId}_100` },
                    { text: '➕ 500⭐', callback_data: `balance_add_${targetUserId}_500` }
                ],
                // Списание средств
                [
                    { text: '➖ 50⭐', callback_data: `balance_remove_${targetUserId}_50` },
                    { text: '➖ 100⭐', callback_data: `balance_remove_${targetUserId}_100` },
                    { text: '➖ 500⭐', callback_data: `balance_remove_${targetUserId}_500` }
                ],
                // Специальные действия
                [
                    { text: '🎯 Указать сумму', callback_data: `balance_custom_${targetUserId}` },
                    { text: '🔄 Сбросить баланс', callback_data: `balance_reset_${targetUserId}` },
                    { text: '💸 Обнулить', callback_data: `balance_zero_${targetUserId}` }
                ],
                // Навигация
                [
                    { text: '🔙 Назад', callback_data: `manage_user_${targetUserId}` },
                    { text: '📊 Статистика', callback_data: `user_stats_${targetUserId}` }
                ]
            ]
        };
        
        if (messageId) {
            await bot.editMessageText(
                messageText,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                }
            );
        } else {
            await bot.sendMessage(
                chatId,
                messageText,
                {
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                }
            );
        }
        
    } catch (error) {
        console.error('Show balance management error:', error);
        await bot.sendMessage(
            chatId,
            '❌ Ошибка при загрузке управления балансом'
        );
    }
}

// 🔄 ОБРАБОТКА ДЕЙСТВИЙ С БАЛАНСОМ
async function handleBalanceAction(chatId, adminId, targetUserId, action, amount, messageId) {
    try {
        const userResult = await pool.query(
            'SELECT username, first_name, balance FROM user_profiles WHERE user_id = $1',
            [targetUserId]
        );
        
        if (userResult.rows.length === 0) {
            return await bot.editMessageText(
                '❌ Пользователь не найден',
                { chat_id: chatId, message_id: messageId }
            );
        }
        
        const user = userResult.rows[0];
        let newBalance = user.balance || 0;
        let actionText = '';
        let notificationText = '';
        
        switch (action) {
            case 'add':
                newBalance += amount;
                actionText = `пополнен на ${amount}⭐`;
                notificationText = `🎉 Ваш баланс пополнен на ${amount}⭐ администратором!\n💫 Текущий баланс: ${newBalance}⭐`;
                break;
                
            case 'remove':
                if (newBalance >= amount) {
                    newBalance -= amount;
                    actionText = `списано ${amount}⭐`;
                    notificationText = `ℹ️ С вашего баланса списано ${amount}⭐ администратором.\n💫 Текущий баланс: ${newBalance}⭐`;
                } else {
                    newBalance = 0;
                    actionText = `баланс сброшен (было недостаточно средств)`;
                    notificationText = `ℹ️ Ваш баланс был сброшен администратором.\n💫 Текущий баланс: ${newBalance}⭐`;
                }
                break;
                
            case 'reset':
                actionText = `сброшен до 0⭐`;
                newBalance = 0;
                notificationText = `ℹ️ Ваш баланс был сброшен администратором.\n💫 Текущий баланс: ${newBalance}⭐`;
                break;
                
            case 'zero':
                actionText = `обнулен`;
                newBalance = 0;
                notificationText = `ℹ️ Ваш баланс был обнулен администратором.`;
                break;
                
            case 'custom':
                // Обработка произвольной суммы через текстовый ввод
                userBalanceState[adminId] = { targetUserId, action: 'custom' };
                await bot.sendMessage(
                    chatId,
                    `💵 <b>Введите сумму для изменения баланса</b>\n\n` +
                    `Пользователь: ${user.first_name} (@${user.username})\n` +
                    `Текущий баланс: ${user.balance || 0}⭐\n\n` +
                    `<b>Форматы ввода:</b>\n` +
                    `<code>+100</code> - пополнить на 100⭐\n` +
                    `<code>-50</code> - списать 50⭐\n` +
                    `<code>=200</code> - установить баланс 200⭐\n` +
                    `<code>0</code> - обнулить баланс`,
                    { parse_mode: 'HTML' }
                );
                return;
        }
        
        if (action !== 'custom') {
            // Обновляем баланс в базе данных
            await pool.query(
                'UPDATE user_profiles SET balance = $1 WHERE user_id = $2',
                [newBalance, targetUserId]
            );
            
            // Логируем действие
            await pool.query(`
                INSERT INTO admin_actions (admin_id, action_type, target_id, description) 
                VALUES ($1, $2, $3, $4)
            `, [adminId, 'balance_update', targetUserId, 
                `Баланс пользователя ${targetUserId} ${actionText}. Новый баланс: ${newBalance}⭐`]);
            
            // Обновляем сообщение
            await bot.editMessageText(
                `✅ <b>Баланс обновлен!</b>\n\n` +
                `👤 Пользователь: ${user.first_name}\n` +
                `💫 Действие: ${actionText}\n` +
                `💰 Новый баланс: <b>${newBalance}⭐</b>`,
                {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🔙 Назад к управлению', callback_data: `manage_user_${targetUserId}` },
                                { text: '💰 Еще действия', callback_data: `balance_menu_${targetUserId}` }
                            ]
                        ]
                    }
                }
            );
            
            // Уведомляем пользователя
            if (bot && notificationText) {
                try {
                    await bot.sendMessage(targetUserId, notificationText);
                } catch (error) {
                    console.log('Не удалось отправить уведомление пользователю');
                }
            }
        }
        
    } catch (error) {
        console.error('Handle balance action error:', error);
        await bot.editMessageText(
            '❌ Ошибка при изменении баланса',
            { chat_id: chatId, message_id: messageId }
        );
    }
}

// 📊 ДЕТАЛЬНАЯ СТАТИСТИКА ПОЛЬЗОВАТЕЛЯ
async function showUserDetailedStats(chatId, targetUserId, messageId) {
    try {
        const statsResult = await pool.query(`
            SELECT 
                up.user_id,
                up.username,
                up.first_name,
                up.balance,
                up.created_at,
                up.referral_count,
                up.referral_earned,
                up.referred_by,
                -- Статистика по заданиям
                COUNT(ut.id) as total_tasks,
                COUNT(CASE WHEN ut.status = 'completed' THEN 1 END) as completed_tasks,
                COUNT(CASE WHEN ut.status = 'rejected' THEN 1 END) as rejected_tasks,
                COUNT(CASE WHEN ut.status = 'pending_review' THEN 1 END) as pending_tasks,
                COUNT(CASE WHEN ut.status = 'active' THEN 1 END) as active_tasks,
                -- Статистика по выплатам
                COUNT(wr.id) as withdrawal_requests,
                COUNT(CASE WHEN wr.status = 'completed' THEN 1 END) as completed_withdrawals,
                COUNT(CASE WHEN wr.status = 'pending' THEN 1 END) as pending_withdrawals,
                COUNT(CASE WHEN wr.status = 'cancelled' THEN 1 END) as cancelled_withdrawals,
                COALESCE(SUM(CASE WHEN wr.status = 'completed' THEN wr.amount ELSE 0 END), 0) as total_withdrawn,
                -- Реферальная статистика
                ref.username as referrer_username,
                ref.first_name as referrer_name,
                -- Последняя активность
                MAX(ut.started_at) as last_task_activity,
                MAX(wr.created_at) as last_withdrawal_date
            FROM user_profiles up
            LEFT JOIN user_tasks ut ON up.user_id = ut.user_id
            LEFT JOIN withdrawal_requests wr ON up.user_id = wr.user_id
            LEFT JOIN user_profiles ref ON up.referred_by = ref.user_id
            WHERE up.user_id = $1
            GROUP BY up.user_id, ref.username, ref.first_name
        `, [targetUserId]);
        
        if (statsResult.rows.length === 0) {
            return await bot.editMessageText(
                '❌ Пользователь не найден',
                { chat_id: chatId, message_id: messageId }
            );
        }
        
        const stats = statsResult.rows[0];
        const lastActivity = stats.last_task_activity ? 
            new Date(stats.last_task_activity).toLocaleDateString('ru-RU') : 'нет активности';
        const lastWithdrawal = stats.last_withdrawal_date ? 
            new Date(stats.last_withdrawal_date).toLocaleDateString('ru-RU') : 'нет выплат';
        
        const messageText = `
📊 <b>ДЕТАЛЬНАЯ СТАТИСТИКА ПОЛЬЗОВАТЕЛЯ</b>

👤 <b>${stats.first_name}</b> (@${stats.username})
💫 <b>Баланс:</b> ${stats.balance || 0}⭐
📅 <b>Регистрация:</b> ${new Date(stats.created_at).toLocaleDateString('ru-RU')}
🕒 <b>Последняя активность:</b> ${lastActivity}

🎯 <b>ЗАДАНИЯ:</b>
• Всего: ${stats.total_tasks || 0}
• ✅ Выполнено: ${stats.completed_tasks || 0}
• ❌ Отклонено: ${stats.rejected_tasks || 0}
• ⏳ На проверке: ${stats.pending_tasks || 0}
• 🔄 Активные: ${stats.active_tasks || 0}

💳 <b>ВЫПЛАТЫ:</b>
• 📨 Запросов: ${stats.withdrawal_requests || 0}
• ✅ Выведено: ${stats.completed_withdrawals || 0}
• ⏳ Ожидают: ${stats.pending_withdrawals || 0}
• ❌ Отменено: ${stats.cancelled_withdrawals || 0}
• 💰 Сумма: ${stats.total_withdrawn || 0}⭐
• 📅 Последняя: ${lastWithdrawal}

👥 <b>РЕФЕРАЛЫ:</b>
• 👤 Приглашено: ${stats.referral_count || 0}
• 💫 Заработано: ${stats.referral_earned || 0}⭐
• 🎯 Пригласил: ${stats.referrer_username ? `@${stats.referrer_username}` : 'нет'}

💰 <b>ОБЩАЯ СТАТИСТИКА:</b>
• 💸 Всего заработано: ${(stats.balance || 0) + (stats.total_withdrawn || 0)}⭐
• 📈 Эффективность: ${stats.total_tasks ? Math.round((stats.completed_tasks / stats.total_tasks) * 100) : 0}%
        `.trim();
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🔙 Назад', callback_data: `manage_user_${targetUserId}` },
                    { text: '🔄 Обновить', callback_data: `refresh_stats_${targetUserId}` }
                ],
                [
                    { text: '💰 Управление балансом', callback_data: `balance_menu_${targetUserId}` },
                    { text: '📋 История операций', callback_data: `user_operations_${targetUserId}` }
                ]
            ]
        };
        
        await bot.editMessageText(
            messageText,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            }
        );
        
    } catch (error) {
        console.error('Show user stats error:', error);
        await bot.editMessageText(
            '❌ Ошибка при загрузке статистики',
            { chat_id: chatId, message_id: messageId }
        );
    }
}

async function toggleUserBlock(chatId, adminId, targetUserId, messageId) {
    try {
        const userResult = await pool.query(
            'SELECT username, first_name, COALESCE(is_blocked, false) as is_blocked FROM user_profiles WHERE user_id = $1',
            [targetUserId]
        );
        
        if (userResult.rows.length === 0) {
            return await bot.editMessageText(
                '❌ Пользователь не найден',
                { chat_id: chatId, message_id: messageId }
            );
        }
        
        const user = userResult.rows[0];
        const newBlockStatus = !user.is_blocked;
        const actionText = newBlockStatus ? 'заблокирован' : 'разблокирован';
        const emoji = newBlockStatus ? '🚫' : '✅';
        
        // Обновляем статус блокировки
        await pool.query(
            'UPDATE user_profiles SET is_blocked = $1 WHERE user_id = $2',
            [newBlockStatus, targetUserId]
        );
        
        // Логируем действие
        await pool.query(`
            INSERT INTO admin_actions (admin_id, action_type, target_id, description) 
            VALUES ($1, $2, $3, $4)
        `, [adminId, 'user_block', targetUserId, 
            `Пользователь ${targetUserId} ${actionText}`]);
        
        await bot.editMessageText(
            `${emoji} <b>Пользователь ${actionText}!</b>\n\n` +
            `👤 ${user.first_name} (@${user.username})\n` +
            `🆔 ID: <code>${targetUserId}</code>\n` +
            `📊 Статус: ${newBlockStatus ? '🚫 Заблокирован' : '✅ Активен'}`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🔙 Назад', callback_data: `manage_user_${targetUserId}` },
                            { text: '🔄 Обновить', callback_data: `refresh_user_${targetUserId}` }
                        ]
                    ]
                }
            }
        );
        
        // Уведомляем пользователя
        if (bot) {
            try {
                await bot.sendMessage(
                    targetUserId,
                    newBlockStatus ? 
                    `🚫 <b>Ваш аккаунт заблокирован!</b>\n\n` +
                    `Ваш аккаунт был заблокирован администратором. ` +
                    `Для разблокировки обратитесь в поддержку.` :
                    `✅ <b>Ваш аккаунт разблокирован!</b>\n\n` +
                    `Ваш аккаунт был разблокирован администратором. ` +
                    `Теперь вы снова можете пользоваться ботом.`,
                    { parse_mode: 'HTML' }
                );
            } catch (error) {
                console.log('Не удалось отправить уведомление пользователю');
            }
        }
        
    } catch (error) {
        console.error('Toggle user block error:', error);
        await bot.editMessageText(
            '❌ Ошибка при изменении статуса блокировки',
            { chat_id: chatId, message_id: messageId }
        );
    }
}

// 🔧 ОБНОВЛЕННЫЙ ОБРАБОТЧИК CALLBACK-ЗАПРОСОВ
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    
    try {
        // Управление пользователями
        if (data.startsWith('manage_user_')) {
            const targetUserId = data.replace('manage_user_', '');
            const userResult = await pool.query(`
                SELECT * FROM user_profiles WHERE user_id = $1
            `, [targetUserId]);
            
            if (userResult.rows.length > 0) {
                await sendUserManagementPanel(chatId, userResult.rows[0]);
            }
        }
        
        else if (data.startsWith('balance_menu_')) {
            const targetUserId = data.replace('balance_menu_', '');
            await showBalanceManagement(chatId, userId, targetUserId, message.message_id);
        }
        
        else if (data.startsWith('balance_')) {
            const parts = data.replace('balance_', '').split('_');
            const action = parts[0];
            const targetUserId = parts[1];
            const amount = parts[2] ? parseInt(parts[2]) : 0;
            
            await handleBalanceAction(chatId, userId, targetUserId, action, amount, message.message_id);
        }
        
        else if (data.startsWith('user_stats_')) {
            const targetUserId = data.replace('user_stats_', '');
            await showUserDetailedStats(chatId, targetUserId, message.message_id);
        }
        
        else if (data.startsWith('block_user_')) {
            const targetUserId = data.replace('block_user_', '');
            await toggleUserBlock(chatId, userId, targetUserId, message.message_id);
        }
        
        else if (data.startsWith('refresh_user_')) {
            const targetUserId = data.replace('refresh_user_', '');
            const userResult = await pool.query(`
                SELECT * FROM user_profiles WHERE user_id = $1
            `, [targetUserId]);
            
            if (userResult.rows.length > 0) {
                await sendUserManagementPanel(chatId, userResult.rows[0]);
                await bot.deleteMessage(chatId, message.message_id);
            }
        }
        
        else if (data === 'new_search') {
            await bot.sendMessage(
                chatId,
                '🔍 <b>Поиск пользователей</b>\n\n' +
                'Введите команду:\n' +
                '<code>/search юзернейм</code> - поиск по юзернейму\n' +
                '<code>/search ID</code> - поиск по ID пользователя\n' +
                '<code>/search имя</code> - поиск по имени\n\n' +
                'Примеры:\n' +
                '<code>/search john_doe</code>\n' +
                '<code>/search 123456789</code>\n' +
                '<code>/search Иван</code>',
                { parse_mode: 'HTML' }
            );
            await bot.deleteMessage(chatId, message.message_id);
        }
        
        else if (data === 'users_list') {
            // Показать последних пользователей
            const usersResult = await pool.query(`
                SELECT * FROM user_profiles 
                ORDER BY created_at DESC 
                LIMIT 10
            `);
            
            if (usersResult.rows.length > 0) {
                await sendUsersList(chatId, usersResult.rows, 'последние пользователи');
                await bot.deleteMessage(chatId, message.message_id);
            }
        }
        
        // Подтверждаем обработку callback
        await bot.answerCallbackQuery(callbackQuery.id);
        
    } catch (error) {
        console.error('Callback query error:', error);
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Произошла ошибка' });
    }
});

// 📝 КОМАНДА ПОМОЩИ ПО УПРАВЛЕНИЮ ПОЛЬЗОВАТЕЛЯМИ
bot.onText(/\/user_help/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Проверяем права администратора
    const isAdmin = await checkAdminAccess(userId);
    if (!isAdmin) {
        return await bot.sendMessage(
            chatId,
            '❌ У вас нет прав для доступа к этой команде.'
        );
    }
    
    const helpText = `
🛠️ <b>СИСТЕМА УПРАВЛЕНИЯ ПОЛЬЗОВАТЕЛЯМИ</b>

<b>Основные команды:</b>
<code>/search username</code> - поиск по юзернейму
<code>/search 123456</code> - поиск по ID
<code>/search Имя</code> - поиск по имени

<b>Функционал управления:</b>
• 💰 <b>Управление балансом</b> - пополнение, списание, сброс
• 🎭 <b>Права доступа</b> - назначение/снятие админа
• 📊 <b>Детальная статистика</b> - задания, выплаты, рефералы
• 🚫 <b>Блокировка</b> - блокировка/разблокировка пользователей
• 💸 <b>Управление выплатами</b> - история и статусы выплат

<b>Быстрые действия:</b>
• Пополнение баланса: +50, +100, +500 ⭐
• Списание средств: -50, -100, -500 ⭐  
• Сброс баланса: установка 0⭐
• Произвольная сумма: ввод любой суммы

<b>Уведомления:</b>
Пользователи автоматически получают уведомления о всех изменениях их баланса и статуса.
    `.trim();
    
    await bot.sendMessage(
        chatId,
        helpText,
        { 
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔍 Начать поиск', callback_data: 'new_search' },
                        { text: '📋 Список пользователей', callback_data: 'users_list' }
                    ]
                ]
            }
        }
    );
});

// 🔧 ДОБАВЛЯЕМ КОЛОНКУ is_blocked В БАЗУ ДАННЫХ
async function addBlockedColumn() {
    try {
        await pool.query(`
            ALTER TABLE user_profiles 
            ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false
        `);
        console.log('✅ Column is_blocked added to user_profiles');
    } catch (error) {
        console.log('ℹ️ Column is_blocked already exists or error:', error.message);
    }
}

// Вызываем при инициализации
addBlockedColumn();
// Команда помощи по управлению пользователями
bot.onText(/\/admin_help/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Проверяем права администратора
    const isAdmin = await checkAdminAccess(userId);
    if (!isAdmin) {
        return await bot.sendMessage(
            chatId,
            '❌ У вас нет прав для доступа к этой команде.'
        );
    }
    
    const helpText = `
🛠️ <b>Команды для управления пользователями</b>

<b>Поиск пользователей:</b>
<code>/search_user username</code> - поиск по юзернейму
<code>/user 123456</code> - поиск по ID пользователя

<b>Управление балансом:</b>
• Пополнение счета
• Списание средств  
• Установка произвольной суммы
• Сброс баланса

<b>Управление правами:</b>
• Назначение администраторов
• Разжалование администраторов

<b>Просмотр статистики:</b>
• Детальная статистика заданий
• История выплат
• Реферальная статистика 

Для начала работы используйте команду поиска.
    `.trim();
    
    await bot.sendMessage(
        chatId,
        helpText,
        { parse_mode: 'HTML' }
    );
});
// 🔥 ОБНОВЛЕННАЯ КОМАНДА /referral
bot.onText(/\/referral/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        const userResult = await pool.query(
            'SELECT referral_code, referral_count, referral_earned, first_name FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            return await bot.sendMessage(chatId, '❌ Сначала зарегистрируйтесь с помощью /start');
        }
        
        const user = userResult.rows[0];
        const referralLink = `https://t.me/LinkGoldMoney_bot?start=${user.referral_code}`;
        const shareText = `Присоединяйся к LinkGold и начни зарабатывать Telegram Stars! 🚀 Получи 2⭐ за регистрацию по моей ссылке!`;
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareText)}`;
        
        await bot.sendMessage(
            chatId,
            `📢 <b>Реферальная программа LinkGold</b>\n\n` +
            `🎁 <b>Новая система:</b>\n` +
            `• Друг получает: <b>2⭐</b> за регистрацию\n` +
            `• Друг получает: <b>90%</b> от своего заработка\n` +
            `• Вы получаете: <b>10%</b> от заработка друга\n` +
            `• Автоматически с каждого задания\n\n` +
            `📊 <b>Ваша статистика:</b>\n` +
            `• Приглашено: <b>${user.referral_count || 0} чел.</b>\n` +
            `• Заработано: <b>${user.referral_earned || 0}⭐</b>\n\n` +
            `🔗 <b>Ваша ссылка:</b>\n<code>${referralLink}</code>`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '👥 Поделиться с друзьями',
                                url: shareUrl
                            }
                        ]
                    ]
                }
            }
        );
        
    } catch (error) {
        console.error('Referral command error:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при получении реферальной ссылки.');
    }
});
// Команда для проверки баланса
bot.onText(/\/balance/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        const userResult = await pool.query(
            'SELECT balance, referral_code, first_name FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            return await bot.sendMessage(chatId, '❌ Сначала зарегистрируйтесь с помощью /start');
        }
        
        const user = userResult.rows[0];
        const balance = user.balance || 0;
        
        await bot.sendMessage(
            chatId,
            `💰 <b>Ваш баланс: ${balance}⭐</b>\n\n` +
            `<b>💫 LinkGold - биржа заработка Telegram Stars</b>\n` +
            `Выполняйте задания, приглашайте друзей и участвуйте в розыгрышах!\n\n` +
            `🚀 <b>Начните зарабатывать прямо сейчас!</b>`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
              
                        [
                            {
                                text: '📢 Наш канал',
                                url: 'https://t.me/LinkGoldChannel1'
                            }
                        ],
                        [
                            {
                                text: '👥 Пригласить друзей',
                                callback_data: 'referral'
                            }
                        ]
                    ]
                }
            }
        );
        
    } catch (error) {
        console.error('Balance command error:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при проверке баланса.');
    }
});


// Обработчик callback кнопок
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    
    try {
        if (data === 'referral') {
            const userResult = await pool.query(
                'SELECT referral_code FROM user_profiles WHERE user_id = $1',
                [userId]
            );
            
            if (userResult.rows.length > 0) {
                const user = userResult.rows[0];
                const referralLink = `https://t.me/LinkGoldMoney_bot?start=${user.referral_code}`;
                const shareText = `Присоединяйся к LinkGold - бирже заработка Telegram Stars! 🚀 Выполняй задания, участвуй в розыгрышах и зарабатывай вместе со мной!`;
                const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareText)}`;
                
                await bot.sendMessage(
                    chatId,
                    `🔗 <b>Ваша реферальная ссылка:</b>\n<code>${referralLink}</code>\n\n` +
                    `🎁 <b>За каждого приглашенного друга:</b>\n` +
                    `• Вы получаете: 10⭐\n` +
                    `• Друг получает: 5⭐`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text: '👥 Поделиться с друзьями',
                                        url: shareUrl
                                    }
                                    
                                ]
                            ]
                        }
                    }
                );
            }
        }
        

        if (data === 'send_notification') {
            // Проверяем права администратора
            const isAdmin = await checkAdminAccess(userId);
            if (!isAdmin) {
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: '❌ У вас нет прав для отправки уведомлений'
                });
                return;
            }
            
            await bot.sendMessage(
                chatId,
                '📢 <b>Отправка уведомления всем пользователям</b>\n\n' +
                'Введите команду:\n' +
                '<code>/notify [ваше сообщение]</code>\n\n' +
                'Пример:\n' +
                '<code>/notify Всем привет! Новые задания уже доступны!</code>',
                {
                    parse_mode: 'HTML'
                }
            );
        }
        
 if (data.startsWith('toggle_admin_')) {
            const targetUserId = data.replace('toggle_admin_', '');
            await toggleAdminStatus(chatId, userId, targetUserId, message.message_id);
        }
        
        else if (data.startsWith('manage_balance_')) {
            const targetUserId = data.replace('manage_balance_', '');
            await showBalanceManagement(chatId, userId, targetUserId, message.message_id);
        }
        
        else if (data.startsWith('refresh_user_')) {
            const targetUserId = data.replace('refresh_user_', '');
            await refreshUserInfo(chatId, targetUserId, message.message_id);
        }
        
        else if (data.startsWith('user_stats_')) {
            const targetUserId = data.replace('user_stats_', '');
            await showUserStats(chatId, targetUserId, message.message_id);
        }
        
        else if (data.startsWith('balance_action_')) {
            const [action, targetUserId, amount] = data.replace('balance_action_', '').split('_');
            await handleBalanceAction(chatId, userId, targetUserId, action, parseInt(amount), message.message_id);
        }
        
        // Подтверждаем обработку callback
        await bot.answerCallbackQuery(callbackQuery.id);
        
    } catch (error) {
        console.error('Callback query error:', error);
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Произошла ошибка' });
    }
});
// ... остальные endpoints остаются без изменений ...


// Переключение статуса администратора
async function toggleAdminStatus(chatId, adminId, targetUserId, messageId) {
    // Проверяем права - только главный админ может управлять админами
    if (parseInt(adminId) !== ADMIN_ID) {
        return await bot.sendMessage(
            chatId,
            '❌ Только главный администратор может управлять правами доступа.'
        );
    }
    
    try {
        const userResult = await pool.query(
            'SELECT is_admin, username, first_name FROM user_profiles WHERE user_id = $1',
            [targetUserId]
        );
        
        if (userResult.rows.length === 0) {
            return await bot.editMessageText(
                '❌ Пользователь не найден',
                { chat_id: chatId, message_id: messageId }
            );
        }
        
        const user = userResult.rows[0];
        const newAdminStatus = !user.is_admin;
        
        // Обновляем статус администратора
        await pool.query(
            'UPDATE user_profiles SET is_admin = $1 WHERE user_id = $2',
            [newAdminStatus, targetUserId]
        );
        
        // Добавляем права доступа если делаем админом
        if (newAdminStatus) {
            try {
                await pool.query(`
                    INSERT INTO admin_permissions (admin_id, can_posts, can_tasks, can_verification, can_support, can_payments)
                    VALUES ($1, true, true, true, true, true)
                    ON CONFLICT (admin_id) DO UPDATE SET 
                        can_posts = true,
                        can_tasks = true,
                        can_verification = true,
                        can_support = true,
                        can_payments = true
                `, [targetUserId]);
            } catch (error) {
                console.log('⚠️ Could not set admin permissions:', error.message);
            }
        }
        
        const actionText = newAdminStatus ? 'назначен администратором' : 'разжалован из администраторов';
        
        await bot.editMessageText(
            `✅ Пользователь ${user.first_name} (@${user.username}) ${actionText}!`,
            { chat_id: chatId, message_id: messageId }
        );
        
        // Отправляем уведомление пользователю
        if (bot) {
            try {
                await bot.sendMessage(
                    targetUserId,
                    newAdminStatus ? 
                    `🎉 <b>Поздравляем!</b>\n\nВы были назначены администратором в LinkGold!` :
                    `ℹ️ <b>Уведомление</b>\n\nВы больше не являетесь администратором LinkGold.`,
                    { parse_mode: 'HTML' }
                );
            } catch (error) {
                console.log('Не удалось отправить уведомление пользователю');
            }
        }
        
    } catch (error) {
        console.error('Toggle admin error:', error);
        await bot.editMessageText(
            '❌ Ошибка при изменении статуса администратора',
            { chat_id: chatId, message_id: messageId }
        );
    }
}

// Управление балансом пользователя
async function showBalanceManagement(chatId, adminId, targetUserId, messageId) {
    try {
        const userResult = await pool.query(
            'SELECT username, first_name, balance FROM user_profiles WHERE user_id = $1',
            [targetUserId]
        );
        
        if (userResult.rows.length === 0) {
            return await bot.editMessageText(
                '❌ Пользователь не найден',
                { chat_id: chatId, message_id: messageId }
            );
        }
        
        const user = userResult.rows[0];
        
        const messageText = `
💰 <b>Управление балансом</b>

👤 Пользователь: ${user.first_name} (@${user.username})
💫 Текущий баланс: <b>${user.balance || 0}⭐</b>

Выберите действие:
        `.trim();
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '➕ Пополнить 50⭐', callback_data: `balance_action_add_${targetUserId}_50` },
                    { text: '➕ Пополнить 100⭐', callback_data: `balance_action_add_${targetUserId}_100` }
                ],
                [
                    { text: '➖ Списать 50⭐', callback_data: `balance_action_remove_${targetUserId}_50` },
                    { text: '➖ Списать 100⭐', callback_data: `balance_action_remove_${targetUserId}_100` }
                ],
                [
                    { text: '🎯 Указать сумму', callback_data: `balance_action_custom_${targetUserId}` },
                    { text: '🔄 Сбросить баланс', callback_data: `balance_action_reset_${targetUserId}` }
                ],
                [
                    { text: '🔙 Назад', callback_data: `refresh_user_${targetUserId}` }
                ]
            ]
        };
        
        await bot.editMessageText(
            messageText,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            }
        );
        
    } catch (error) {
        console.error('Show balance management error:', error);
        await bot.editMessageText(
            '❌ Ошибка при загрузке управления балансом',
            { chat_id: chatId, message_id: messageId }
        );
    }
}

// Обработка действий с балансом
async function handleBalanceAction(chatId, adminId, targetUserId, action, amount, messageId) {
    try {
        const userResult = await pool.query(
            'SELECT username, first_name, balance FROM user_profiles WHERE user_id = $1',
            [targetUserId]
        );
        
        if (userResult.rows.length === 0) {
            return await bot.editMessageText(
                '❌ Пользователь не найден',
                { chat_id: chatId, message_id: messageId }
            );
        }
        
        const user = userResult.rows[0];
        let newBalance = user.balance || 0;
        let actionText = '';
        
        switch (action) {
            case 'add':
                newBalance += amount;
                actionText = `пополнен на ${amount}⭐`;
                break;
                
            case 'remove':
                if (newBalance >= amount) {
                    newBalance -= amount;
                    actionText = `списано ${amount}⭐`;
                } else {
                    newBalance = 0;
                    actionText = `баланс сброшен (было недостаточно средств)`;
                }
                break;
                
            case 'reset':
                actionText = `сброшен до 0⭐`;
                newBalance = 0;
                break;
                
            case 'custom':
                // Здесь можно реализовать запрос произвольной суммы
                await bot.sendMessage(
                    chatId,
                    `Введите сумму для изменения баланса пользователя ${user.first_name}:\n\n` +
                    `Примеры:\n` +
                    `+100 - пополнить на 100⭐\n` +
                    `-50 - списать 50⭐\n` +
                    `=200 - установить баланс 200⭐`
                );
                // Сохраняем состояние для обработки следующего сообщения
                userBalanceState[adminId] = { targetUserId, action: 'custom' };
                return;
        }
        
        // Обновляем баланс в базе данных
        await pool.query(
            'UPDATE user_profiles SET balance = $1 WHERE user_id = $2',
            [newBalance, targetUserId]
        );
        
        // Логируем действие
        await pool.query(`
            INSERT INTO admin_actions (admin_id, action_type, target_id, description) 
            VALUES ($1, $2, $3, $4)
        `, [adminId, 'balance_update', targetUserId, `Баланс пользователя ${targetUserId} ${actionText}. Новый баланс: ${newBalance}⭐`]);
        
        await bot.editMessageText(
            `✅ Баланс пользователя ${user.first_name} ${actionText}\n\n` +
            `💫 Новый баланс: <b>${newBalance}⭐</b>`,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML'
            }
        );
        
        // Уведомляем пользователя об изменении баланса
        if (bot && action !== 'custom') {
            try {
                let notificationText = '';
                if (action === 'add') {
                    notificationText = `🎉 Ваш баланс пополнен на ${amount}⭐ администратором!\n💫 Текущий баланс: ${newBalance}⭐`;
                } else if (action === 'remove') {
                    notificationText = `ℹ️ С вашего баланса списано ${amount}⭐ администратором.\n💫 Текущий баланс: ${newBalance}⭐`;
                } else if (action === 'reset') {
                    notificationText = `ℹ️ Ваш баланс был сброшен администратором.\n💫 Текущий баланс: ${newBalance}⭐`;
                }
                
                if (notificationText) {
                    await bot.sendMessage(targetUserId, notificationText);
                }
            } catch (error) {
                console.log('Не удалось отправить уведомление пользователю');
            }
        }
        
    } catch (error) {
        console.error('Handle balance action error:', error);
        await bot.editMessageText(
            '❌ Ошибка при изменении баланса',
            { chat_id: chatId, message_id: messageId }
        );
    }
}

// Обновление информации о пользователе
async function refreshUserInfo(chatId, targetUserId, messageId) {
    try {
        const userResult = await pool.query(`
            SELECT 
                up.user_id,
                up.username,
                up.first_name,
                up.last_name,
                up.balance,
                up.is_admin,
                up.created_at,
                up.referral_count,
                up.referral_earned,
                COUNT(ut.id) as total_tasks,
                COUNT(CASE WHEN ut.status = 'completed' THEN 1 END) as completed_tasks,
                COUNT(CASE WHEN ut.status = 'rejected' THEN 1 END) as rejected_tasks,
                COUNT(CASE WHEN ut.status = 'pending_review' THEN 1 END) as pending_tasks
            FROM user_profiles up
            LEFT JOIN user_tasks ut ON up.user_id = ut.user_id
            WHERE up.user_id = $1
            GROUP BY up.user_id
        `, [targetUserId]);
        
        if (userResult.rows.length === 0) {
            return await bot.editMessageText(
                '❌ Пользователь не найден',
                { chat_id: chatId, message_id: messageId }
            );
        }
        
        const user = userResult.rows[0];
        await sendUserInfo(chatId, user);
        
        // Удаляем старое сообщение
        await bot.deleteMessage(chatId, messageId);
        
    } catch (error) {
        console.error('Refresh user info error:', error);
        await bot.editMessageText(
            '❌ Ошибка при обновлении информации',
            { chat_id: chatId, message_id: messageId }
        );
    }
}

// Показать детальную статистику пользователя
async function showUserStats(chatId, targetUserId, messageId) {
    try {
        const statsResult = await pool.query(`
            SELECT 
                up.user_id,
                up.username,
                up.first_name,
                up.balance,
                up.created_at,
                -- Статистика по заданиям
                COUNT(ut.id) as total_tasks,
                COUNT(CASE WHEN ut.status = 'completed' THEN 1 END) as completed_tasks,
                COUNT(CASE WHEN ut.status = 'rejected' THEN 1 END) as rejected_tasks,
                COUNT(CASE WHEN ut.status = 'pending_review' THEN 1 END) as pending_tasks,
                COUNT(CASE WHEN ut.status = 'active' THEN 1 END) as active_tasks,
                -- Статистика по выплатам
                COUNT(wr.id) as withdrawal_requests,
                COUNT(CASE WHEN wr.status = 'completed' THEN 1 END) as completed_withdrawals,
                COALESCE(SUM(CASE WHEN wr.status = 'completed' THEN wr.amount ELSE 0 END), 0) as total_withdrawn,
                -- Реферальная статистика
                up.referral_count,
                up.referral_earned,
                -- Последняя активность
                MAX(ut.started_at) as last_task_activity
            FROM user_profiles up
            LEFT JOIN user_tasks ut ON up.user_id = ut.user_id
            LEFT JOIN withdrawal_requests wr ON up.user_id = wr.user_id
            WHERE up.user_id = $1
            GROUP BY up.user_id
        `, [targetUserId]);
        
        if (statsResult.rows.length === 0) {
            return await bot.editMessageText(
                '❌ Пользователь не найден',
                { chat_id: chatId, message_id: messageId }
            );
        }
        
        const stats = statsResult.rows[0];
        const lastActivity = stats.last_task_activity ? 
            new Date(stats.last_task_activity).toLocaleDateString('ru-RU') : 'нет активности';
        
        const messageText = `
📊 <b>Детальная статистика пользователя</b>

👤 <b>${stats.first_name}</b> (@${stats.username})
💫 <b>Баланс:</b> ${stats.balance || 0}⭐
📅 <b>Регистрация:</b> ${new Date(stats.created_at).toLocaleDateString('ru-RU')}
🕒 <b>Последняя активность:</b> ${lastActivity}

🎯 <b>Задания:</b>
• Всего: ${stats.total_tasks || 0}
• Выполнено: ${stats.completed_tasks || 0}
• Отклонено: ${stats.rejected_tasks || 0}
• На проверке: ${stats.pending_tasks || 0}
• Активные: ${stats.active_tasks || 0}

💳 <b>Выплаты:</b>
• Запросов: ${stats.withdrawal_requests || 0}
• Выведено: ${stats.completed_withdrawals || 0}
• Сумма: ${stats.total_withdrawn || 0}⭐

👥 <b>Рефералы:</b>
• Приглашено: ${stats.referral_count || 0}
• Заработано: ${stats.referral_earned || 0}⭐
        `.trim();
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🔙 Назад', callback_data: `refresh_user_${targetUserId}` }
                ]
            ]
        };
        
        await bot.editMessageText(
            messageText,
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard
            }
        );
        
    } catch (error) {
        console.error('Show user stats error:', error);
        await bot.editMessageText(
            '❌ Ошибка при загрузке статистики',
            { chat_id: chatId, message_id: messageId }
        );
    }
}

// Глобальная переменная для хранения состояния
const userBalanceState = {};

// Обработчик текстовых сообщений для ввода произвольной суммы
bot.on('message', async (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text.trim();
        
        // Проверяем, ожидаем ли мы ввод суммы для управления балансом
        if (userBalanceState[userId] && userBalanceState[userId].action === 'custom') {
            const { targetUserId } = userBalanceState[userId];
            delete userBalanceState[userId]; // Очищаем состояние
            
            try {
                let amount = 0;
                let action = '';
                let newBalance = 0;
                
                const userResult = await pool.query(
                    'SELECT username, first_name, balance FROM user_profiles WHERE user_id = $1',
                    [targetUserId]
                );
                
                if (userResult.rows.length === 0) {
                    return await bot.sendMessage(chatId, '❌ Пользователь не найден');
                }
                
                const user = userResult.rows[0];
                const currentBalance = user.balance || 0;
                
                // Парсим ввод пользователя
                if (text.startsWith('+')) {
                    amount = parseInt(text.substring(1));
                    action = 'add';
                    if (isNaN(amount) || amount <= 0) {
                        return await bot.sendMessage(chatId, '❌ Неверная сумма для пополнения');
                    }
                    newBalance = currentBalance + amount;
                    
                } else if (text.startsWith('-')) {
                    amount = parseInt(text.substring(1));
                    action = 'remove';
                    if (isNaN(amount) || amount <= 0) {
                        return await bot.sendMessage(chatId, '❌ Неверная сумма для списания');
                    }
                    newBalance = Math.max(0, currentBalance - amount);
                    
                } else if (text.startsWith('=')) {
                    amount = parseInt(text.substring(1));
                    action = 'set';
                    if (isNaN(amount) || amount < 0) {
                        return await bot.sendMessage(chatId, '❌ Неверная сумма для установки');
                    }
                    newBalance = amount;
                    
                } else {
                    return await bot.sendMessage(
                        chatId,
                        '❌ Неверный формат. Используйте:\n' +
                        '+100 - пополнить\n' +
                        '-50 - списать\n' +
                        '=200 - установить'
                    );
                }
                
                // Обновляем баланс
                await pool.query(
                    'UPDATE user_profiles SET balance = $1 WHERE user_id = $2',
                    [newBalance, targetUserId]
                );
                
                // Логируем действие
                await pool.query(`
                    INSERT INTO admin_actions (admin_id, action_type, target_id, description) 
                    VALUES ($1, $2, $3, $4)
                `, [userId, 'balance_update', targetUserId, `Баланс пользователя ${targetUserId} изменен: ${text}. Новый баланс: ${newBalance}⭐`]);
                
                await bot.sendMessage(
                    chatId,
                    `✅ Баланс пользователя ${user.first_name} обновлен!\n\n` +
                    `💫 Новый баланс: <b>${newBalance}⭐</b>`,
                    { parse_mode: 'HTML' }
                );
                
                // Уведомляем пользователя
                if (bot) {
                    try {
                        let notificationText = '';
                        if (action === 'add') {
                            notificationText = `🎉 Ваш баланс пополнен на ${amount}⭐ администратором!\n💫 Текущий баланс: ${newBalance}⭐`;
                        } else if (action === 'remove') {
                            notificationText = `ℹ️ С вашего баланса списано ${amount}⭐ администратором.\n💫 Текущий баланс: ${newBalance}⭐`;
                        } else if (action === 'set') {
                            notificationText = `ℹ️ Ваш баланс установлен на ${amount}⭐ администратором.\n💫 Текущий баланс: ${newBalance}⭐`;
                        }
                        
                        await bot.sendMessage(targetUserId, notificationText);
                    } catch (error) {
                        console.log('Не удалось отправить уведомление пользователю');
                    }
                }
                
            } catch (error) {
                console.error('Custom balance action error:', error);
                await bot.sendMessage(chatId, '❌ Ошибка при изменении баланса');
            }
        }
    }
});

// Health check с информацией о конфигурации
// Улучшенный health check
app.get('/api/health', async (req, res) => {
    try {
        // Проверяем подключение к БД
        const dbResult = await pool.query('SELECT 1');
        const dbStatus = dbResult ? 'connected' : 'disconnected';
        
        const healthInfo = {
            status: 'OK',
            timestamp: new Date().toISOString(),
            database: dbStatus,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            environment: process.env.NODE_ENV || 'development'
        };
        
        res.json(healthInfo);
    } catch (error) {
        console.error('Health check failed:', error);
        res.status(500).json({
            status: 'ERROR',
            message: 'Database connection failed',
            error: error.message
        });
    }
});

// Диагностика таблицы промокодов
app.get('/api/admin/promocodes/debug-structure', async (req, res) => {
    try {
        const structure = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'promocodes' 
            ORDER BY ordinal_position
        `);
        
        const tableExists = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'promocodes'
            )
        `);
        
        res.json({
            success: true,
            table_exists: tableExists.rows[0].exists,
            columns: structure.rows,
            current_timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Promocodes structure debug error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// ==================== WITHDRAWAL REQUESTS FOR ADMINS ====================
// Endpoint для принудительного исправления таблицы промокодов
app.post('/api/admin/promocodes/fix-table', async (req, res) => {
    try {
        await fixPromocodesTable();
        
        // Проверяем структуру после исправления
        const structure = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'promocodes' 
            ORDER BY ordinal_position
        `);
        
        res.json({
            success: true,
            message: 'Таблица промокодов исправлена',
            structure: structure.rows
        });
    } catch (error) {
        console.error('Fix promocodes table error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Предпросмотр изображения задания
function previewTaskImage(input) {
    const preview = document.getElementById('task-image-preview');
    const img = document.getElementById('task-preview-img');
    
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            img.src = e.target.result;
            preview.style.display = 'block';
        }
        
        reader.readAsDataURL(input.files[0]);
    } else {
        preview.style.display = 'none';
    }
}

// Очистка изображения
function clearTaskImage() {
    const input = document.getElementById('admin-task-image');
    const preview = document.getElementById('task-image-preview');
    
    input.value = '';
    preview.style.display = 'none';
}
async function fixTasksTable() {
    try {
        console.log('🔧 Checking and fixing tasks table structure...');
        
        // Проверяем существование колонки image_url
        const columnCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'tasks' AND column_name = 'image_url'
        `);
        
        if (columnCheck.rows.length === 0) {
            console.log('❌ Column image_url not found, adding...');
            await pool.query(`ALTER TABLE tasks ADD COLUMN image_url TEXT`);
            console.log('✅ Column image_url added successfully');
        } else {
            console.log('✅ Column image_url already exists');
        }
        
        // Проверяем другие важные колонки
        const columnsToCheck = [
            'created_by', 'category', 'time_to_complete', 
            'difficulty', 'people_required', 'repost_time', 'task_url'
        ];
        
        for (const column of columnsToCheck) {
            const exists = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'tasks' AND column_name = $1
            `, [column]);
            
            if (exists.rows.length === 0) {
                console.log(`❌ Column ${column} not found, adding...`);
                let columnType = 'TEXT';
                if (column === 'created_by') columnType = 'BIGINT';
                if (column === 'people_required') columnType = 'INTEGER';
                
                await pool.query(`ALTER TABLE tasks ADD COLUMN ${column} ${columnType}`);
                console.log(`✅ Column ${column} added`);
            }
        }
        
        console.log('✅ Tasks table structure verified and fixed');
    } catch (error) {
        console.error('❌ Error fixing tasks table:', error);
    }
}
async function addTask() {
    console.log('🎯 Starting add task function...');
    
    try {
        // Получаем значения из формы
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

        // Валидация
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

        // Подготавливаем данные для отправки
        const requestData = {
            title: taskData.title.trim(),
            description: taskData.description.trim(),
            price: price,
            category: taskData.category || 'general',
            time_to_complete: taskData.time_to_complete || '5-10 минут',
            difficulty: taskData.difficulty || 'Легкая',
            people_required: parseInt(taskData.people_required) || 1,
            task_url: taskData.task_url || '',
            created_by: currentUser.id
        };

        console.log('📤 Sending request to server:', requestData);

        const result = await makeRequest('/api/tasks', {
            method: 'POST',
            body: JSON.stringify(requestData)
        });

        console.log('📨 Server response:', result);

        if (result.success) {
            showNotification('✅ Задание успешно создано!', 'success');
            
            // Очищаем форму
            clearTaskForm();
            
            // Обновляем списки заданий
            setTimeout(() => {
                loadAdminTasks();
                loadTasks();
            }, 1000);
            
        } else {
            throw new Error(result.error || 'Unknown server error');
        }

    } catch (error) {
        console.error('💥 Error in addTask:', error);
        showNotification(`❌ Ошибка создания задания: ${error.message}`, 'error');
    }
}
// Принудительное исправление таблицы промокодов
app.post('/api/admin/promocodes/fix-table', async (req, res) => {
    try {
        await fixPromocodesTable();
        
        // Проверяем структуру после исправления
        const structure = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'promocodes' 
            ORDER BY ordinal_position
        `);
        
        res.json({
            success: true,
            message: 'Таблица промокодов исправлена',
            structure: structure.rows
        });
    } catch (error) {
        console.error('Fix promocodes table error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/tasks', async (req, res) => {
    const { 
        title, 
        description, 
        price, 
        created_by,
        category,
        time_to_complete,
        difficulty,
        people_required,
        task_url
    } = req.body;
    
    console.log('🔍 Parsed data:', {
        title, description, price, created_by, category,
        time_to_complete, difficulty, people_required, task_url
    });
    
    // 🔧 ПРОВЕРКА ПРАВ АДМИНА
    if (!created_by) {
        return res.status(400).json({
            success: false,
            error: 'Отсутствует ID создателя'
        });
    }
    
    const isAdmin = await checkAdminAccess(created_by);
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            error: 'Только администратор может создавать задания!'
        });
    }
    
    
    // Базовая валидация
    if (!title || !description || !price) {
        console.log('❌ Validation failed: missing required fields');
        return res.status(400).json({
            success: false,
            error: 'Заполните все обязательные поля'
        });
    }
    
    try {
        const taskPrice = parseFloat(price);
        if (isNaN(taskPrice) || taskPrice <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Цена должна быть положительным числом!'
            });
        }

        console.log('💾 Saving task to database...');
        
          
        const result = await pool.query(`
            INSERT INTO tasks (
                title, description, price, created_by, category,
                time_to_complete, difficulty, people_required, task_url
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [
            title.trim(), 
            description.trim(), 
            taskPrice, 
            created_by,
            category || 'general',
            time_to_complete || '5-10 минут',
            difficulty || 'Легкая',
            parseInt(people_required) || 1,
            task_url || ''
        ]);
        
        console.log('✅ Task saved successfully:', result.rows[0]);
        
        res.json({
            success: true,
            message: 'Задание успешно создано!',
            task: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ Create task error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка базы данных: ' + error.message
        });
    }
});

// ==================== WITHDRAWAL REQUESTS FOR ADMINS ====================

// ==================== NOTIFICATION ENDPOINTS ====================

// Отправка уведомлений всем пользователям (только для главного админа)
app.post('/api/admin/send-notification', async (req, res) => {
    const { adminId, message } = req.body;
    
    console.log('📢 Notification request from admin:', { adminId, message });
    
    try {
        // 🔥 ВАЖНОЕ ИСПРАВЛЕНИЕ: Проверяем что это именно главный админ
        if (parseInt(adminId) !== ADMIN_ID) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен. Только главный администратор может отправлять уведомления.'
            });
        }
        
        if (!message || message.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Сообщение не может быть пустым'
            });
        }
        
        // Сохраняем запись об уведомлении
        const notificationRecord = await pool.query(`
            INSERT INTO admin_notifications (admin_id, message, sent_count, failed_count) 
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [adminId, message, 0, 0]);
        
        // Получаем всех пользователей из базы данных
        const usersResult = await pool.query(
            'SELECT user_id FROM user_profiles WHERE user_id != $1',
            [adminId]
        );
        
        const users = usersResult.rows;
        console.log(`📨 Найдено ${users.length} пользователей для отправки уведомлений`);
        
        let successCount = 0;
        let failCount = 0;
        const failedUsers = [];
        
        // Отправляем уведомление каждому пользователю с обработкой ошибок
        for (const user of users) {
            try {
                if (bot) {
                    await bot.sendMessage(
                        user.user_id,
                        `📢 <b>Уведомление от администратора LinkGold:</b>\n\n${message}`,
                        { parse_mode: 'HTML' }
                    );
                    successCount++;
                    
                    // Задержка чтобы не превысить лимиты Telegram (20 сообщений в секунду)
                    await new Promise(resolve => setTimeout(resolve, 50));
                } else {
                    console.log('⚠️ Bot not initialized, skipping message send');
                    failCount++;
                    failedUsers.push({
                        user_id: user.user_id,
                        error: 'Bot not initialized'
                    });
                }
            } catch (error) {
                console.error(`❌ Ошибка отправки пользователю ${user.user_id}:`, error.message);
                failCount++;
                failedUsers.push({
                    user_id: user.user_id,
                    error: error.message
                });
                
                // Если ошибка связана с блокировкой бота, пропускаем пользователя
                if (error.response && error.response.statusCode === 403) {
                    console.log(`🚫 Бот заблокирован пользователем ${user.user_id}`);
                }
            }
        }
        
        // Обновляем статистику отправки
        await pool.query(`
            UPDATE admin_notifications 
            SET sent_count = $1, failed_count = $2 
            WHERE id = $3
        `, [successCount, failCount, notificationRecord.rows[0].id]);
        
        console.log(`✅ Уведомления отправлены: ${successCount} успешно, ${failCount} с ошибкой`);
        
        res.json({
            success: true,
            message: `Уведомление отправлено ${successCount} пользователям`,
            stats: {
                total: users.length,
                success: successCount,
                failed: failCount
            },
            failedUsers: failedUsers.length > 0 ? failedUsers.slice(0, 10) : undefined,
            notificationId: notificationRecord.rows[0].id
        });
        
    } catch (error) {
        console.error('❌ Send notification error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при отправке уведомлений: ' + error.message
        });
    }
});

// Полная статистика пользователей с детализацией
app.get('/api/admin/users-detailed-stats', async (req, res) => {
    const { adminId, limit = 50, offset = 0, search = '' } = req.query;
    
    console.log('📊 Detailed users stats request from admin:', adminId);
    
    try {
        // Проверяем права администратора
        const isAdmin = await checkAdminAccess(adminId);
        if (!isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен. Только администраторы могут просматривать статистику.'
            });
        }
        
        // Основная статистика
        const mainStats = await pool.query(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN is_admin = true THEN 1 END) as admin_users,
                COUNT(CASE WHEN balance > 0 THEN 1 END) as users_with_balance,
                COUNT(CASE WHEN referred_by IS NOT NULL THEN 1 END) as referred_users,
                COUNT(CASE WHEN balance >= 200 THEN 1 END) as users_can_withdraw,
                SUM(COALESCE(balance, 0)) as total_balance,
                AVG(COALESCE(balance, 0)) as avg_balance,
                MAX(COALESCE(balance, 0)) as max_balance,
                SUM(COALESCE(referral_count, 0)) as total_referrals,
                SUM(COALESCE(referral_earned, 0)) as total_referral_earnings
            FROM user_profiles
            WHERE user_id != $1
        `, [ADMIN_ID]);
        
        // Статистика по активностям
        const activityStats = await pool.query(`
            SELECT 
                COUNT(DISTINCT user_id) as users_with_tasks,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks,
                COUNT(CASE WHEN status = 'pending_review' THEN 1 END) as pending_tasks,
                COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_tasks,
                SUM(CASE WHEN status = 'completed' THEN t.price ELSE 0 END) as total_earned_from_tasks
            FROM user_tasks ut
            JOIN tasks t ON ut.task_id = t.id
        `);
        
        // Статистика по датам
        const dateStats = await pool.query(`
            SELECT 
                COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) as new_today,
                COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as new_week,
                COUNT(CASE WHEN created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as new_month,
                TO_CHAR(created_at, 'YYYY-MM-DD') as date,
                COUNT(*) as daily_registrations
            FROM user_profiles 
            WHERE user_id != $1 AND created_at >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
            ORDER BY date DESC
            LIMIT 30
        `, [ADMIN_ID]);
        
        // Детальный список пользователей с поиском и пагинацией
        let usersQuery = `
            SELECT 
                up.user_id,
                up.username,
                up.first_name,
                up.last_name,
                up.balance,
                up.referral_count,
                up.referral_earned,
                up.referred_by,
                up.is_admin,
                up.created_at,
                ref.username as referrer_username,
                ref.first_name as referrer_name,
                COUNT(ut.id) as total_tasks,
                COUNT(CASE WHEN ut.status = 'completed' THEN 1 END) as completed_tasks,
                COUNT(CASE WHEN ut.status = 'pending_review' THEN 1 END) as pending_tasks,
                COALESCE(SUM(CASE WHEN ut.status = 'completed' THEN t.price ELSE 0 END), 0) as total_earned
            FROM user_profiles up
            LEFT JOIN user_profiles ref ON up.referred_by = ref.user_id
            LEFT JOIN user_tasks ut ON up.user_id = ut.user_id
            LEFT JOIN tasks t ON ut.task_id = t.id
        `;
        
        let queryParams = [ADMIN_ID];
        let whereConditions = ['up.user_id != $1'];
        let paramCount = 1;
        
        if (search) {
            paramCount++;
            whereConditions.push(`
                (up.username ILIKE $${paramCount} 
                 OR up.first_name ILIKE $${paramCount} 
                 OR up.last_name ILIKE $${paramCount}
                 OR up.user_id::text = $${paramCount})
            `);
            queryParams.push(`%${search}%`);
        }
        
        if (whereConditions.length > 0) {
            usersQuery += ' WHERE ' + whereConditions.join(' AND ');
        }
        
        usersQuery += `
            GROUP BY up.user_id, ref.username, ref.first_name
            ORDER BY up.created_at DESC
            LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
        `;
        
        queryParams.push(parseInt(limit), parseInt(offset));
        
        const usersResult = await pool.query(usersQuery, queryParams);
        
        // Топ рефералов
        const topReferrers = await pool.query(`
            SELECT 
                user_id,
                username,
                first_name,
                referral_count,
                referral_earned
            FROM user_profiles 
            WHERE referral_count > 0 
            ORDER BY referral_count DESC, referral_earned DESC 
            LIMIT 10
        `);
        
        // Топ пользователей по балансу
        const topBalances = await pool.query(`
            SELECT 
                user_id,
                username,
                first_name,
                balance
            FROM user_profiles 
            WHERE balance > 0 
            ORDER BY balance DESC 
            LIMIT 10
        `);
        
        res.json({
            success: true,
            stats: {
                main: mainStats.rows[0],
                activity: activityStats.rows[0],
                dates: dateStats.rows,
                top_referrers: topReferrers.rows,
                top_balances: topBalances.rows
            },
            users: usersResult.rows,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                total: parseInt(mainStats.rows[0].total_users)
            }
        });
        
    } catch (error) {
        console.error('❌ Get detailed users stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// 🔗 ENDPOINTS ДЛЯ РЕФЕРАЛЬНЫХ ССЫЛОК

// Создание реферальной ссылки
// Создание реферальной ссылки - ИСПРАВЛЕННАЯ ВЕРСИЯ
// Создание реферальной ссылки с базовой статистикой
app.post('/api/admin/links/create', async (req, res) => {
    const { adminId, name, description, createdBy } = req.body;
    
    console.log('🔗 Create referral link request:', { adminId, name, description, createdBy });
    
    try {
        // Проверка прав администратора
        const isAdmin = await checkAdminAccess(adminId);
        if (!isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен. Только администраторы могут создавать ссылки.'
            });
        }
        
        // Генерируем уникальный код
        const code = generateReferralCode();
        
        // Создаем ссылку на бота
        const referralUrl = `https://t.me/LinkGoldMoney_bot?start=${code}`;
        
        // Создаем запись в базе данных с начальной статистикой
        const result = await pool.query(`
            INSERT INTO referral_links (code, name, description, created_by, referral_url, total_clicks, unique_clicks, conversions) 
            VALUES ($1, $2, $3, $4, $5, 0, 0, 0)
            RETURNING *
        `, [code, name.trim(), description?.trim() || '', createdBy, referralUrl]);
        
        console.log('✅ Referral link created with tracking:', result.rows[0]);
        
        res.json({
            success: true,
            message: `Ссылка "${name}" успешно создана!`,
            link: result.rows[0],
            referralUrl: referralUrl
        });
        
    } catch (error) {
        console.error('❌ Create referral link error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка базы данных: ' + error.message
        });
    }
});
// Отслеживание кликов по реферальным ссылкам
app.post('/api/referral-links/track-click', async (req, res) => {
    const { code, userId, ipAddress, userAgent } = req.body;
    
    try {
        // Находим ссылку по коду
        const linkResult = await pool.query(
            'SELECT id FROM referral_links WHERE code = $1 AND is_active = true',
            [code]
        );
        
        if (linkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Ссылка не найдена'
            });
        }
        
        const linkId = linkResult.rows[0].id;
        
        // Проверяем уникальность клика (по IP и user agent)
        const uniqueCheck = await pool.query(`
            SELECT id FROM referral_link_clicks 
            WHERE link_id = $1 AND ip_address = $2 AND user_agent = $3
            LIMIT 1
        `, [linkId, ipAddress, userAgent]);
        
        const isUniqueClick = uniqueCheck.rows.length === 0;
        
        // Обновляем статистику
        await pool.query(`
            UPDATE referral_links 
            SET total_clicks = total_clicks + 1,
                unique_clicks = unique_clicks + $1
            WHERE id = $2
        `, [isUniqueClick ? 1 : 0, linkId]);
        
        // Сохраняем информацию о клике
        await pool.query(`
            INSERT INTO referral_link_clicks (link_id, user_id, ip_address, user_agent)
            VALUES ($1, $2, $3, $4)
        `, [linkId, userId, ipAddress, userAgent]);
        
        res.json({
            success: true,
            isUnique: isUniqueClick,
            message: 'Клик зарегистрирован'
        });
        
    } catch (error) {
        console.error('Track click error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отслеживания клика'
        });
    }
});
// Отслеживание конверсий (регистраций по ссылке)
app.post('/api/referral-links/track-conversion', async (req, res) => {
    const { code, userId } = req.body;
    
    try {
        // Находим ссылку по коду
        const linkResult = await pool.query(
            'SELECT id FROM referral_links WHERE code = $1 AND is_active = true',
            [code]
        );
        
        if (linkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Ссылка не найдена'
            });
        }
        
        const linkId = linkResult.rows[0].id;
        
        // Обновляем счетчик конверсий
        await pool.query(`
            UPDATE referral_links 
            SET conversions = conversions + 1
            WHERE id = $1
        `, [linkId]);
        
        res.json({
            success: true,
            message: 'Конверсия зарегистрирована'
        });
        
    } catch (error) {
        console.error('Track conversion error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отслеживания конверсии'
        });
    }
});
// Функция для проверки и восстановления таблицы referral_links
async function fixReferralLinksTable() {
    try {
        console.log('🔧 Checking referral_links table structure...');
        
        // Проверяем существование таблицы
        const tableExists = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'referral_links'
            )
        `);
        
        if (!tableExists.rows[0].exists) {
            console.log('❌ referral_links table does not exist, creating...');
            await pool.query(`
                CREATE TABLE IF NOT EXISTS referral_links (
                    id SERIAL PRIMARY KEY,
                    code VARCHAR(20) UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT,
                    created_by BIGINT NOT NULL,
                    referral_url TEXT NOT NULL,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (created_by) REFERENCES user_profiles(user_id)
                )
            `);
            console.log('✅ referral_links table created');
        }
        
        
        // Проверяем и добавляем отсутствующие колонки
        const columnsToCheck = [
            {name: 'description', type: 'TEXT'},
            {name: 'is_active', type: 'BOOLEAN', defaultValue: 'true'},
            {name: 'created_at', type: 'TIMESTAMP', defaultValue: 'CURRENT_TIMESTAMP'}
        ];
        
        for (const column of columnsToCheck) {
            const columnExists = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'referral_links' AND column_name = $1
                )
            `, [column.name]);
            
            if (!columnExists.rows[0].exists) {
                console.log(`❌ Column ${column.name} missing, adding...`);
                await pool.query(`
                    ALTER TABLE referral_links 
                    ADD COLUMN ${column.name} ${column.type} 
                    ${column.defaultValue ? `DEFAULT ${column.defaultValue}` : ''}
                `);
                console.log(`✅ Column ${column.name} added`);
            }
        }
        
        console.log('✅ referral_links table structure verified');
    } catch (error) {
        console.error('❌ Error fixing referral_links table:', error);
    }
}

// Вызовите эту функцию при инициализации сервера
async function initializeServer() {
    await initDatabase();
    await fixReferralLinksTable(); // Добавьте эту строку
    await createSampleTasks();
}
// Получение списка ссылок
// Улучшенный endpoint для получения списка ссылок
app.get('/api/admin/links/list', async (req, res) => {
    const { adminId } = req.query;
    
    try {
        // Проверка прав администратора
        const isAdmin = await checkAdminAccess(adminId);
        if (!isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        // Сначала проверяем и исправляем таблицу
        await fixReferralLinksTable();
        
        const result = await pool.query(`
            SELECT rl.*, 
                   up.username as creator_username,
                   up.first_name as creator_name,
                   COUNT(ra.id) as activation_count,
                   COALESCE(SUM(ra.reward_amount), 0) as total_earned
            FROM referral_links rl
            LEFT JOIN user_profiles up ON rl.created_by = up.user_id
            LEFT JOIN referral_activations ra ON rl.id = ra.link_id
            WHERE rl.is_active = true
            GROUP BY rl.id, up.username, up.first_name
            ORDER BY rl.created_at DESC
        `);
        
        console.log(`✅ Found ${result.rows.length} active referral links`);
        
        res.json({
            success: true,
            links: result.rows
        });
        
    } catch (error) {
        console.error('Get referral links error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Функция для восстановления потерянных ссылок
app.post('/api/admin/links/recover', async (req, res) => {
    const { adminId } = req.body;
    
    if (parseInt(adminId) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен'
        });
    }
    
    try {
        console.log('🔧 Attempting to recover referral links...');
        
        // 1. Проверяем структуру таблицы
        await fixReferralLinksTable();
        
        // 2. Проверяем, есть ли ссылки в базе
        const linksCount = await pool.query('SELECT COUNT(*) FROM referral_links WHERE is_active = true');
        
        // 3. Если ссылок нет, создаем пример
        if (parseInt(linksCount.rows[0].count) === 0) {
            console.log('📝 No links found, creating sample link...');
            
            const sampleCode = generateReferralCode();
            const sampleUrl = `https://t.me/LinkGoldMoney_bot?start=${sampleCode}`;
            
            await pool.query(`
                INSERT INTO referral_links (code, name, description, created_by, referral_url) 
                VALUES ($1, $2, $3, $4, $5)
            `, [sampleCode, 'Пример ссылки', 'Тестовая реферальная ссылка', ADMIN_ID, sampleUrl]);
            
            console.log('✅ Sample link created');
        }
        
        // 4. Получаем обновленный список
        const result = await pool.query(`
            SELECT * FROM referral_links 
            WHERE is_active = true 
            ORDER BY created_at DESC
        `);
        
        res.json({
            success: true,
            message: `Восстановлено ${result.rows.length} ссылок`,
            links: result.rows
        });
        
    } catch (error) {
        console.error('Recover links error:', error);
        res.status(500).json({
            success: false,
            error: 'Recovery error: ' + error.message
        });
    }
});

// Удаление ссылки
app.post('/api/admin/links/delete', async (req, res) => {
    const { adminId, code } = req.body;
    
    try {
        // Проверка прав администратора
        const isAdmin = await checkAdminAccess(adminId);
        if (!isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        // Проверяем, может ли админ удалить эту ссылку
        const linkCheck = await pool.query(
            'SELECT created_by FROM referral_links WHERE code = $1',
            [code]
        );
        
        if (linkCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Ссылка не найдена'
            });
        }
        
        const linkCreator = linkCheck.rows[0].created_by;
        const isMainAdmin = parseInt(adminId) === ADMIN_ID;
        
        if (!isMainAdmin && parseInt(linkCreator) !== parseInt(adminId)) {
            return res.status(403).json({
                success: false,
                error: 'Вы можете удалять только свои ссылки!'
            });
        }
        
        // Деактивируем ссылку
        await pool.query(
            'UPDATE referral_links SET is_active = false WHERE code = $1',
            [code]
        );
        
        res.json({
            success: true,
            message: 'Ссылка успешно удалена!'
        });
        
    } catch (error) {
        console.error('Delete referral link error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Настройки доступа к ссылкам
app.get('/api/admin/links/settings', async (req, res) => {
    const { adminId } = req.query;
    
    if (parseInt(adminId) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен'
        });
    }
    
    try {
        const result = await pool.query(`
            SELECT allow_admins_links FROM admin_settings WHERE id = 1
        `);
        
        res.json({
            success: true,
            allowAdminsLinks: result.rows.length > 0 ? result.rows[0].allow_admins_links : false
        });
        
    } catch (error) {
        console.error('Get link settings error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

app.post('/api/admin/links/settings', async (req, res) => {
    const { adminId, allowAdminsLinks } = req.body;
    
    if (parseInt(adminId) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен'
        });
    }
    
    try {
        await pool.query(`
            INSERT INTO admin_settings (id, allow_admins_links) 
            VALUES (1, $1)
            ON CONFLICT (id) 
            DO UPDATE SET allow_admins_links = $1
        `, [allowAdminsLinks]);
        
        res.json({
            success: true,
            message: 'Настройки сохранены!'
        });
        
    } catch (error) {
        console.error('Save link settings error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Вспомогательная функция для генерации кода
// Вспомогательная функция для генерации кода
function generateReferralCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return 'LINK_' + result;
}
// Экспорт данных пользователей
app.get('/api/admin/users-export', async (req, res) => {
    const { adminId, format = 'json' } = req.query;
    
    try {
        // Проверяем права администратора
        const isAdmin = await checkAdminAccess(adminId);
        if (!isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен.'
            });
        }
        
        const usersResult = await pool.query(`
            SELECT 
                up.user_id,
                up.username,
                up.first_name,
                up.last_name,
                up.balance,
                up.referral_count,
                up.referral_earned,
                up.referred_by,
                up.is_admin,
                up.created_at,
                ref.username as referrer_username,
                COUNT(ut.id) as total_tasks,
                COUNT(CASE WHEN ut.status = 'completed' THEN 1 END) as completed_tasks,
                COALESCE(SUM(CASE WHEN ut.status = 'completed' THEN t.price ELSE 0 END), 0) as total_earned
            FROM user_profiles up
            LEFT JOIN user_profiles ref ON up.referred_by = ref.user_id
            LEFT JOIN user_tasks ut ON up.user_id = ut.user_id
            LEFT JOIN tasks t ON ut.task_id = t.id
            WHERE up.user_id != $1
            GROUP BY up.user_id, ref.username
            ORDER BY up.created_at DESC
        `, [ADMIN_ID]);
        
        if (format === 'csv') {
            // Генерируем CSV
            const headers = ['ID', 'Username', 'First Name', 'Balance', 'Referrals', 'Referral Earned', 'Tasks Completed', 'Total Earned', 'Registration Date'];
            let csv = headers.join(',') + '\n';
            
            usersResult.rows.forEach(user => {
                const row = [
                    user.user_id,
                    user.username || '',
                    user.first_name || '',
                    user.balance || 0,
                    user.referral_count || 0,
                    user.referral_earned || 0,
                    user.completed_tasks || 0,
                    user.total_earned || 0,
                    user.created_at
                ].map(field => `"${field}"`).join(',');
                
                csv += row + '\n';
            });
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=users_export.csv');
            return res.send(csv);
        } else {
            // JSON формат
            res.json({
                success: true,
                users: usersResult.rows,
                exported_at: new Date().toISOString(),
                total_users: usersResult.rows.length
            });
        }
        
    } catch (error) {
        console.error('❌ Users export error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Получение статистики пользователей для админ-панели
app.get('/api/admin/users-stats', async (req, res) => {
    const { adminId } = req.query;
    
    // Проверяем права администратора
    const isAdmin = await checkAdminAccess(adminId);
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен'
        });
    }
    
    try {
        // Получаем общую статистику пользователей
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN is_admin = true THEN 1 END) as admin_users,
                COUNT(CASE WHEN balance > 0 THEN 1 END) as users_with_balance,
                COUNT(CASE WHEN referred_by IS NOT NULL THEN 1 END) as referred_users,
                SUM(COALESCE(balance, 0)) as total_balance,
                AVG(COALESCE(balance, 0)) as avg_balance
            FROM user_profiles
            WHERE user_id != $1
        `, [ADMIN_ID]);
        
        // Получаем последних зарегистрированных пользователей
        const recentUsers = await pool.query(`
            SELECT user_id, username, first_name, balance, created_at 
            FROM user_profiles 
            WHERE user_id != $1
            ORDER BY created_at DESC 
            LIMIT 10
        `, [ADMIN_ID]);
        
        res.json({
            success: true,
            stats: statsResult.rows[0],
            recentUsers: recentUsers.rows
        });
        
    } catch (error) {
        console.error('Get users stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Получение заявок на вывод для всех админов
app.get('/api/admin/withdrawal-requests', async (req, res) => {
    const { adminId } = req.query;
    
    console.log('🔄 Запрос на получение заявок на вывод от админа:', adminId);
    
    // Проверка прав администратора - РАЗРЕШАЕМ ВСЕМ АДМИНАМ
    const isAdmin = await checkAdminAccess(adminId);
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен. Только администраторы могут просматривать заявки на вывод.'
        });
    }
    
    try {
        const result = await pool.query(`
            SELECT wr.*, u.username, u.first_name 
            FROM withdrawal_requests wr
            LEFT JOIN user_profiles u ON wr.user_id = u.user_id
            WHERE wr.status = 'pending'
            ORDER BY wr.created_at DESC
        `);
        
        console.log(`✅ Найдено ${result.rows.length} заявок на вывод для админа ${adminId}`);
        
        res.json({
            success: true,
            requests: result.rows
        });
    } catch (error) {
        console.error('❌ Get withdrawal requests error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
// Добавьте эту функцию и вызовите ее в initDatabase()
async function fixWithdrawalTableStructure() {
    try {
        console.log('🔧 Fixing withdrawal_requests table structure...');
        
        // Проверяем и добавляем недостающие колонки
        const columnsToAdd = [
            'completed_at TIMESTAMP',
            'completed_by BIGINT',
            'username TEXT', 
            'first_name TEXT'
        ];
        
        for (const columnDef of columnsToAdd) {
            const columnName = columnDef.split(' ')[0];
            try {
                await pool.query(`
                    ALTER TABLE withdrawal_requests 
                    ADD COLUMN IF NOT EXISTS ${columnDef}
                `);
                console.log(`✅ Added column: ${columnName}`);
            } catch (error) {
                console.log(`ℹ️ Column ${columnName} already exists or error:`, error.message);
            }
        }
        
        console.log('✅ Withdrawal table structure fixed');
    } catch (error) {
        console.error('❌ Error fixing withdrawal table:', error);
    }
}



// Подтверждение выплаты для всех админов
app.post('/api/admin/withdrawal-requests/:requestId/complete', async (req, res) => {
    const requestId = req.params.requestId;
    const { adminId } = req.body;
    
    console.log('✅ Подтверждение выплаты админом:', { requestId, adminId });
    
    // Проверка прав администратора - РАЗРЕШАЕМ ВСЕМ АДМИНАМ
    const isAdmin = await checkAdminAccess(adminId);
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен. Только администраторы могут подтверждать выплаты.'
        });
    }
    
    try {
        // Проверяем существование запроса
        const requestCheck = await pool.query(
            'SELECT * FROM withdrawal_requests WHERE id = $1 AND status = $2',
            [requestId, 'pending']
        );
        
        if (requestCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Запрос не найден или уже обработан'
            });
        }
        
        const withdrawalRequest = requestCheck.rows[0];
        
        // Обновляем статус запроса
        await pool.query(`
            UPDATE withdrawal_requests 
            SET status = 'completed', 
                completed_at = CURRENT_TIMESTAMP,
                completed_by = $1
            WHERE id = $2
        `, [adminId, requestId]);
        
        console.log(`✅ Выплата подтверждена админом ${adminId} для запроса ${requestId}`);
        
        // Отправляем уведомление пользователю через бота (если бот активен)
        if (bot) {
            try {
                await bot.sendMessage(
                    withdrawalRequest.user_id,
                    `🎉 Ваша заявка на вывод ${withdrawalRequest.amount}⭐ была обработана и средства перечислены!`
                );
            } catch (botError) {
                console.log('Не удалось отправить уведомление пользователю:', botError.message);
            }
        }
        
        res.json({
            success: true,
            message: 'Выплата успешно подтверждена!'
        });
        
    } catch (error) {
        console.error('❌ Complete withdrawal error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});


// 🔧 ДИАГНОСТИКА ПРОБЛЕМ С ЗАГРУЗКОЙ ФАЙЛОВ
app.get('/api/debug/uploads', async (req, res) => {
    try {
        const uploadsDir = path.join(__dirname, 'uploads');
        const files = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : [];
        
        // Проверяем записи в базе данных
        const dbScreenshots = await pool.query(`
            SELECT screenshot_url, COUNT(*) as count 
            FROM task_verifications 
            WHERE screenshot_url IS NOT NULL 
            GROUP BY screenshot_url
            LIMIT 10
        `);
        
        res.json({
            success: true,
            uploads: {
                directory: uploadsDir,
                exists: fs.existsSync(uploadsDir),
                fileCount: files.length,
                files: files.slice(0, 10)
            },
            database: {
                totalVerifications: (await pool.query('SELECT COUNT(*) FROM task_verifications')).rows[0].count,
                withScreenshots: (await pool.query('SELECT COUNT(*) FROM task_verifications WHERE screenshot_url IS NOT NULL')).rows[0].count,
                sampleScreenshots: dbScreenshots.rows
            }
        });
    } catch (error) {
        console.error('Uploads debug error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get user profile
app.get('/api/user/:userId', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1', 
            [req.params.userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        res.json({
            success: true,
            profile: result.rows[0]
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// ==================== POSTS ENDPOINTS ====================

// Get all posts
app.get('/api/posts', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM posts 
            ORDER BY created_at DESC
        `);
        
        res.json({
            success: true,
            posts: result.rows
        });
    } catch (error) {
        console.error('Get posts error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Create post (for all admins) - УПРОЩЕННАЯ ВЕРСИЯ БЕЗ ПРОВЕРОК
app.post('/api/posts', async (req, res) => {
    const { title, content, author, authorId } = req.body;
    
    if (!title || !content || !author) {
        return res.status(400).json({
            success: false,
            error: 'Заполните все поля'
        });
    }
    
    try {
        const result = await pool.query(`
            INSERT INTO posts (title, content, author, author_id) 
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [title, content, author, authorId]);
        
        res.json({
            success: true,
            message: 'Пост успешно опубликован!',
            post: result.rows[0]
        });
    } catch (error) {
        console.error('Create post error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка базы данных'
        });
    }
});

// Delete post (for all admins) - УПРОЩЕННАЯ ВЕРСИЯ БЕЗ ПРОВЕРОК
app.delete('/api/posts/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM posts WHERE id = $1", [req.params.id]);
        res.json({
            success: true,
            message: 'Пост успешно удален!'
        });
    } catch (error) {
        console.error('Delete post error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// ==================== TASKS ENDPOINTS ====================

// Получение заданий с правильной фильтрацией отклоненных заданий
app.get('/api/tasks', async (req, res) => {
    const { search, category, userId } = req.query;
    
    console.log('📥 Получен запрос на задания:', { search, category, userId });
    
    try {
        let query = `
            SELECT t.*, 
                   COUNT(ut.id) as completed_count,
                   EXISTS(
                       SELECT 1 FROM user_tasks ut2 
                       WHERE ut2.task_id = t.id 
                       AND ut2.user_id = $1 
                       AND ut2.status IN ('active', 'pending_review', 'completed')
                   ) as user_has_task,
                   -- ДОБАВЛЕНО: проверяем есть ли отклоненные задания у пользователя
                   EXISTS(
                       SELECT 1 FROM user_tasks ut3 
                       WHERE ut3.task_id = t.id 
                       AND ut3.user_id = $1 
                       AND ut3.status = 'rejected'
                   ) as user_has_rejected_task
            FROM tasks t 
            LEFT JOIN user_tasks ut ON t.id = ut.task_id AND ut.status = 'completed'
            WHERE t.status = 'active'
        `;
        let params = [userId];
        let paramCount = 1;
        
        if (search) {
            paramCount++;
            query += ` AND (t.title ILIKE $${paramCount} OR t.description ILIKE $${paramCount + 1})`;
            params.push(`%${search}%`, `%${search}%`);
            paramCount += 2;
        }
        
        if (category && category !== 'all') {
            paramCount++;
            query += ` AND t.category = $${paramCount}`;
            params.push(category);
        }
        
        query += ` GROUP BY t.id ORDER BY t.created_at DESC`;
        
        console.log('📊 Выполняем запрос:', query, params);
        
        const result = await pool.query(query, params);
        
        // 🔥 ФИЛЬТРУЕМ ЗАДАНИЯ: показываем только те, которые не достигли лимита исполнителей
        const availableTasks = result.rows.filter(task => {
            const completedCount = task.completed_count || 0;
            const peopleRequired = task.people_required || 1;
            return completedCount < peopleRequired;
        });
        
        // 🔥 ВАЖНОЕ ИСПРАВЛЕНИЕ: Фильтруем задания, которые пользователь уже начал ИЛИ ОТКЛОНЕНЫ
        const filteredTasks = availableTasks.filter(task => {
            const hasActiveTask = task.user_has_task;
            const hasRejectedTask = task.user_has_rejected_task;
            
            // Не показываем задание если:
            // 1. Пользователь уже начал это задание (активное, на проверке или выполненное)
            // 2. Пользователь уже имеет отклоненную версию этого задания
            return !hasActiveTask && !hasRejectedTask;
        });
        
        // 🔧 ИСПРАВЛЕНИЕ: Обеспечиваем правильные URL для изображений
        const tasksWithCorrectedImages = filteredTasks.map(task => {
            if (task.image_url) {
                if (!task.image_url.startsWith('http')) {
                    task.image_url = `${APP_URL}${task.image_url}`;
                }
                task.image_url += `${task.image_url.includes('?') ? '&' : '?'}t=${Date.now()}`;
            }
            return task;
        });
        
        console.log(`✅ Найдено заданий: ${result.rows.length}, доступно по лимиту: ${availableTasks.length}, доступно пользователю: ${filteredTasks.length}`);
        console.log(`🎯 Отклоненные задания отфильтрованы: ${availableTasks.length - filteredTasks.length} заданий скрыто`);
        
        res.json({
            success: true,
            tasks: tasksWithCorrectedImages,
            totalCount: result.rows.length,
            availableByLimit: availableTasks.length,
            availableCount: filteredTasks.length
        });
    } catch (error) {
        console.error('❌ Get tasks error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
// Debug endpoint for tasks
app.get('/api/debug/tasks', async (req, res) => {
    try {
        const tasksCount = await pool.query('SELECT COUNT(*) FROM tasks WHERE status = $1', ['active']);
        const tasks = await pool.query('SELECT * FROM tasks WHERE status = $1 ORDER BY created_at DESC LIMIT 10', ['active']);
        
        res.json({
            success: true,
            total_active_tasks: parseInt(tasksCount.rows[0].count),
            sample_tasks: tasks.rows,
            database_status: 'OK'
        });
    } catch (error) {
        console.error('Debug tasks error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// В server.js добавьте:
app.get('/api/debug/tasks-test', async (req, res) => {
    try {
        const { userId } = req.query;
        console.log('🧪 Debug tasks request for user:', userId);
        
        const tasks = await pool.query(`
            SELECT * FROM tasks 
            WHERE status = 'active'
            ORDER BY created_at DESC
            LIMIT 5
        `);
        
        console.log('📊 Found tasks:', tasks.rows.length);
        
        res.json({
            success: true,
            tasks: tasks.rows,
            debug: {
                userId: userId,
                timestamp: new Date().toISOString(),
                taskCount: tasks.rows.length
            }
        });
    } catch (error) {
        console.error('Debug tasks error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Создание задания с изображением
app.post('/api/tasks-with-image', upload.single('image'), async (req, res) => {
    console.log('📥 Received task creation request with image');
    
    const { 
        title, 
        description, 
        price, 
        created_by,
        category,
        time_to_complete,
        difficulty,
        people_required,
        task_url
    } = req.body;
    
    // Базовая валидация
    if (!title || !description || !price || !created_by) {
        return res.status(400).json({
            success: false,
            error: 'Заполните все обязательные поля'
        });
    }
    
    try {
        const taskPrice = parseFloat(price);
        if (isNaN(taskPrice) || taskPrice <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Цена должна быть положительным числом!'
            });
        }

        // 🔧 ИСПРАВЛЕНИЕ: Правильная обработка изображения
        let imageUrl = '';
        if (req.file) {
            // Используем абсолютный URL для изображения
            imageUrl = `${APP_URL}/uploads/${req.file.filename}`;
            console.log('🖼️ Image uploaded with absolute URL:', imageUrl);
        }

        console.log('💾 Saving task to database with image...');
        
        const result = await pool.query(`
            INSERT INTO tasks (
                title, description, price, created_by, category,
                time_to_complete, difficulty, people_required, task_url, image_url
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `, [
            title.trim(), 
            description.trim(), 
            taskPrice, 
            created_by,
            category || 'general',
            time_to_complete || '5-10 минут',
            difficulty || 'Легкая',
            parseInt(people_required) || 1,
            task_url || '',
            imageUrl
        ]);
        
        console.log('✅ Task with image saved successfully:', result.rows[0]);
        
        res.json({
            success: true,
            message: imageUrl ? 'Задание с фото успешно создано!' : 'Задание успешно создано!',
            task: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ Create task with image error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка базы данных: ' + error.message
        });
    }
});
app.get('/api/debug/tasks-structure', async (req, res) => {
    try {
        const structure = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'tasks' 
            ORDER BY ordinal_position
        `);
        
        res.json({
            success: true,
            columns: structure.rows
        });
    } catch (error) {
        console.error('Tasks structure debug error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// В server.js добавьте этот endpoint

// Поиск заданий в админке
app.get('/api/admin/tasks/search', async (req, res) => {
    const { adminId, search } = req.query;
    
    if (!adminId) {
        return res.status(400).json({
            success: false,
            error: 'ID администратора обязателен'
        });
    }

    try {
        // Проверяем права администратора
        const adminCheck = await pool.query(
            'SELECT is_admin FROM user_profiles WHERE user_id = $1',
            [adminId]
        );

        if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен. Только для администраторов.'
            });
        }

        let query = `
            SELECT 
                t.*,
                COUNT(ut.id) as completed_count,
                COUNT(CASE WHEN ut.status = 'rejected' THEN 1 END) as rejected_count,
                COUNT(CASE WHEN ut.status = 'pending' THEN 1 END) as pending_count,
                COUNT(CASE WHEN ut.status = 'active' THEN 1 END) as active_count,
                MAX(ut.completed_at) as last_completed
            FROM tasks t
            LEFT JOIN user_tasks ut ON t.id = ut.task_id
        `;

        const queryParams = [];
        let whereConditions = [];

        // Добавляем условия поиска если есть поисковый запрос
        if (search && search.trim() !== '') {
            whereConditions.push(`
                (t.title ILIKE $${queryParams.length + 1} 
                 OR t.description ILIKE $${queryParams.length + 1}
                 OR t.category ILIKE $${queryParams.length + 1})
            `);
            queryParams.push(`%${search}%`);
        }

        if (whereConditions.length > 0) {
            query += ' WHERE ' + whereConditions.join(' AND ');
        }

        query += `
            GROUP BY t.id
            ORDER BY t.created_at DESC
        `;

        const result = await pool.query(query, queryParams);

        // Получаем статистику
        const statsQuery = `
            SELECT 
                COUNT(*) as total_tasks,
                COUNT(CASE WHEN t.status = 'active' THEN 1 END) as active_tasks,
                COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_tasks,
                COUNT(CASE WHEN t.created_by = $1 THEN 1 END) as my_tasks
            FROM tasks t
            ${search ? `WHERE (t.title ILIKE $2 OR t.description ILIKE $2 OR t.category ILIKE $2)` : ''}
        `;

        const statsParams = [adminId];
        if (search) {
            statsParams.push(`%${search}%`);
        }

        const statsResult = await pool.query(statsQuery, statsParams);

        res.json({
            success: true,
            tasks: result.rows,
            statistics: statsResult.rows[0],
            searchTerm: search || ''
        });

    } catch (error) {
        console.error('Search tasks error:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера: ' + error.message
        });
    }
});

// Функция для добавления недостающих колонок в таблицу tasks
async function fixTasksTable() {
    try {
        console.log('🔧 Checking and fixing tasks table structure...');
        
        // Проверяем существование колонки image_url
        const columnCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'tasks' AND column_name = 'image_url'
        `);
        
        if (columnCheck.rows.length === 0) {
            console.log('❌ Column image_url not found, adding...');
            await pool.query(`ALTER TABLE tasks ADD COLUMN image_url TEXT`);
            console.log('✅ Column image_url added successfully');
        } else {
            console.log('✅ Column image_url already exists');
        }
        
        // Проверяем другие важные колонки
        const columnsToCheck = [
            'created_by', 'category', 'time_to_complete', 
            'difficulty', 'people_required', 'repost_time', 'task_url'
        ];
        
        for (const column of columnsToCheck) {
            const exists = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'tasks' AND column_name = $1
            `, [column]);
            
            if (exists.rows.length === 0) {
                console.log(`❌ Column ${column} not found, adding...`);
                let columnType = 'TEXT';
                if (column === 'created_by') columnType = 'BIGINT';
                if (column === 'people_required') columnType = 'INTEGER';
                
                await pool.query(`ALTER TABLE tasks ADD COLUMN ${column} ${columnType}`);
                console.log(`✅ Column ${column} added`);
            }
        }
        
        console.log('✅ Tasks table structure verified and fixed');
    } catch (error) {
        console.error('❌ Error fixing tasks table:', error);
    }
}
// Функция для создания тестовых заданий
async function createSampleTasks() {
    try {
        console.log('📝 Creating sample tasks...');
        
        // Проверяем, есть ли уже задания
        const tasksCount = await pool.query('SELECT COUNT(*) FROM tasks WHERE status = $1', ['active']);
        
        if (parseInt(tasksCount.rows[0].count) === 0) {
            console.log('🔄 No active tasks found, creating sample tasks...');
            
            const sampleTasks = [
                {
                    title: 'Подписаться на Telegram канал',
                    description: 'Подпишитесь на наш Telegram канал и оставайтесь подписанным минимум 3 дня. Сделайте скриншот подписки.',
                    price: 50,
                    category: 'subscribe',
                    time_to_complete: '5 минут',
                    difficulty: 'Легкая',
                    people_required: 100
                },
                {
                    title: 'Посмотреть видео на YouTube',
                    description: 'Посмотрите видео до конца и поставьте лайк. Пришлите скриншот с видео и лайком.',
                    price: 30,
                    category: 'view',
                    time_to_complete: '10 минут', 
                    difficulty: 'Легкая',
                    people_required: 50
                },
                {
                    title: 'Сделать репост записи',
                    description: 'Сделайте репост записи в своем Telegram канале или чате. Скриншот репоста обязателен.',
                    price: 70,
                    category: 'repost',
                    time_to_complete: '5 минут',
                    difficulty: 'Средняя',
                    people_required: 30
                },
                {
                    title: 'Оставить комментарий под постом',
                    description: 'Напишите содержательный комментарий под указанным постом. Комментарий должен быть уникальным.',
                    price: 40,
                    category: 'comment',
                    time_to_complete: '7 минут',
                    difficulty: 'Легкая', 
                    people_required: 80
                },
                {
                    title: 'Вступить в Telegram группу',
                    description: 'Вступите в нашу Telegram группу и оставайтесь в ней минимум 7 дней.',
                    price: 60,
                    category: 'social',
                    time_to_complete: '3 минуты',
                    difficulty: 'Легкая',
                    people_required: 40
                }
            ];

            for (const task of sampleTasks) {
                await pool.query(`
                    INSERT INTO tasks (title, description, price, created_by, category, time_to_complete, difficulty, people_required) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, [
                    task.title,
                    task.description, 
                    task.price,
                    ADMIN_ID,
                    task.category,
                    task.time_to_complete,
                    task.difficulty,
                    task.people_required
                ]);
            }
            
            console.log('✅ Sample tasks created successfully!');
        } else {
            console.log(`✅ Tasks already exist: ${tasksCount.rows[0].count} active tasks`);
        }
    } catch (error) {
        console.error('❌ Error creating sample tasks:', error);
    }
}

// Вызовите эту функцию после инициализации базы данных
async function initializeWithTasks() {
    await initDatabase();
    await createSampleTasks();
}
// Диагностический endpoint для проверки заданий
app.get('/api/debug/tasks-status', async (req, res) => {
    try {
        // Статистика по заданиям
        const tasksStats = await pool.query(`
            SELECT 
                status,
                COUNT(*) as count,
                COUNT(CASE WHEN created_by = $1 THEN 1 END) as my_tasks
            FROM tasks 
            GROUP BY status
        `, [ADMIN_ID]);
        
        // Все задания
        const allTasks = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC');
        
        // Активные задания
        const activeTasks = await pool.query('SELECT * FROM tasks WHERE status = $1 ORDER BY created_at DESC', ['active']);

        res.json({
            success: true,
            stats: tasksStats.rows,
            all_tasks_count: allTasks.rows.length,
            active_tasks_count: activeTasks.rows.length,
            active_tasks: activeTasks.rows,
            all_tasks: allTasks.rows
        });
    } catch (error) {
        console.error('Tasks status debug error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint для принудительного создания тестовых заданий
app.post('/api/admin/create-sample-tasks', async (req, res) => {
    const { adminId } = req.body;
    
    if (parseInt(adminId) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Access denied'
        });
    }
    
    try {
        await createSampleTasks();
        
        const tasksCount = await pool.query('SELECT COUNT(*) FROM tasks WHERE status = $1', ['active']);
        
        res.json({
            success: true,
            message: 'Sample tasks created successfully',
            active_tasks_count: parseInt(tasksCount.rows[0].count)
        });
    } catch (error) {
        console.error('Create sample tasks error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Test endpoint for task creation
app.post('/api/test-task', async (req, res) => {
    console.log('🧪 Test task endpoint called:', req.body);
    
    try {
        // Простая проверка - возвращаем успех без сохранения в БД
        res.json({
            success: true,
            message: 'Test endpoint works!',
            received_data: req.body
        });
    } catch (error) {
        console.error('Test endpoint error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Check database structure
app.get('/api/debug/database', async (req, res) => {
    try {
        // Проверяем структуру таблицы tasks
        const tableInfo = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'tasks' 
            ORDER BY ordinal_position
        `);
        
        // Проверяем количество записей
        const countResult = await pool.query('SELECT COUNT(*) FROM tasks');
        
        res.json({
            success: true,
            table_structure: tableInfo.rows,
            task_count: parseInt(countResult.rows[0].count),
            database_status: 'OK'
        });
    } catch (error) {
        console.error('Database debug error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Delete task (for all admins) - УПРОЩЕННАЯ ВЕРСИЯ БЕЗ ПРОВЕРОК
app.delete('/api/tasks/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM tasks WHERE id = $1", [req.params.id]);
        res.json({
            success: true,
            message: 'Задание успешно удалено!'
        });
    } catch (error) {
        console.error('Delete task error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Get tasks for admin (show ALL tasks including completed)
app.get('/api/admin/tasks', async (req, res) => {
    const { adminId, showCompleted = 'true' } = req.query;
    
    console.log('🔄 Admin tasks request:', { adminId, showCompleted });
    
    // Проверка прав администратора
    const isAdmin = await checkAdminAccess(adminId);
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен'
        });
    }
    
    try {
        let query = `
            SELECT t.*, 
                   COUNT(ut.id) as completed_count,
                   COUNT(CASE WHEN ut.status = 'completed' THEN 1 END) as actual_completed,
                   COUNT(CASE WHEN ut.status = 'rejected' THEN 1 END) as rejected_count,
                   COUNT(CASE WHEN ut.status = 'pending_review' THEN 1 END) as pending_count
            FROM tasks t 
            LEFT JOIN user_tasks ut ON t.id = ut.task_id
        `;
        
        // Если нужно показать только активные задания
        if (showCompleted === 'false') {
            query += ` WHERE t.status = 'active'`;
        }
        
        query += ` GROUP BY t.id ORDER BY t.created_at DESC`;
        
        console.log('📊 Executing admin tasks query:', query);
        
        const result = await pool.query(query);
        
        console.log(`✅ Found ${result.rows.length} tasks for admin`);
        
        res.json({
            success: true,
            tasks: result.rows,
            stats: {
                total: result.rows.length,
                active: result.rows.filter(t => t.status === 'active').length,
                completed: result.rows.filter(t => t.status === 'completed').length
            }
        });
    } catch (error) {
        console.error('❌ Get admin tasks error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
// В server.js - исправленная функция загрузки админ-заданий
app.get('/api/admin/all-tasks', async (req, res) => {
    const { adminId } = req.query;
    
    console.log('🔄 Admin ALL tasks request from:', adminId);
    
    try {
        // УПРОЩЕННАЯ ПРОВЕРКА - разрешаем всем админам
        const isAdmin = await checkAdminAccess(adminId);
        if (!isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        // ПРОСТОЙ запрос без сложной статистики
        const result = await pool.query(`
            SELECT 
                t.*,
                COUNT(ut.id) as completed_count
            FROM tasks t 
            LEFT JOIN user_tasks ut ON t.id = ut.task_id AND ut.status = 'completed'
            GROUP BY t.id
            ORDER BY t.created_at DESC
        `);
        
        console.log(`✅ Found ${result.rows.length} tasks for admin ${adminId}`);
        
        res.json({
            success: true,
            tasks: result.rows || [],
            statistics: {
                total_tasks: result.rows.length,
                active_tasks: result.rows.filter(t => t.status === 'active').length,
                completed_tasks: result.rows.filter(t => t.status === 'completed').length,
                my_tasks: result.rows.filter(t => t.created_by == adminId).length
            }
        });
        
    } catch (error) {
        console.error('❌ Get all admin tasks error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
// Простой endpoint для админ-заданий
app.get('/api/admin/simple-tasks', async (req, res) => {
    const { adminId } = req.query;
    
    console.log('🎯 Simple admin tasks request from:', adminId);
    
    try {
        // Базовая проверка админа
        const userResult = await pool.query(
            'SELECT is_admin FROM user_profiles WHERE user_id = $1',
            [adminId]
        );
        
        if (userResult.rows.length === 0 || (!userResult.rows[0].is_admin && parseInt(adminId) !== ADMIN_ID)) {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }
        
        // Самый простой запрос
        const result = await pool.query(`
            SELECT * FROM tasks 
            ORDER BY created_at DESC
            LIMIT 50
        `);
        
        console.log(`✅ Simple query: ${result.rows.length} tasks`);
        
        res.json({
            success: true,
            tasks: result.rows,
            debug: {
                adminId: adminId,
                isAdmin: true,
                taskCount: result.rows.length
            }
        });
        
    } catch (error) {
        console.error('Simple admin tasks error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// ==================== USER TASKS ENDPOINTS ====================
// В server.js добавьте:
app.get('/api/debug/admin-tasks', async (req, res) => {
    const { adminId } = req.query;
    
    try {
        // Все задания
        const allTasks = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC');
        
        // Статистика по статусам
        const statusStats = await pool.query(`
            SELECT status, COUNT(*) as count 
            FROM tasks 
            GROUP BY status
        `);
        
        // Задания созданные админом
        const adminTasks = await pool.query(`
            SELECT * FROM tasks 
            WHERE created_by = $1 
            ORDER BY created_at DESC
        `, [adminId]);
        
        res.json({
            success: true,
            all_tasks_count: allTasks.rows.length,
            status_stats: statusStats.rows,
            admin_tasks: adminTasks.rows,
            admin_id: adminId
        });
    } catch (error) {
        console.error('Debug admin tasks error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// В server.js - обновите endpoint начала задания
app.post('/api/user/tasks/start', async (req, res) => {
    const { userId, taskId } = req.body;
    
    console.log('🚀 Start task request:', { userId, taskId });
    
    if (!userId || !taskId) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields'
        });
    }
    
    try {
        // Проверяем, выполнял ли пользователь это задание
        const existingTask = await pool.query(`
    SELECT id FROM user_tasks 
    WHERE user_id = $1 AND task_id = $2 
    AND status IN ('active', 'pending_review', 'completed', 'rejected')
`, [userId, taskId]);
        
        if (existingTask.rows.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Вы уже выполняли это задание'
            });
        }
        
        // Проверяем лимит выполнений
        const taskInfo = await pool.query(`
            SELECT t.*, 
                   COUNT(ut.id) as completed_count
            FROM tasks t
            LEFT JOIN user_tasks ut ON t.id = ut.task_id AND ut.status = 'completed'
            WHERE t.id = $1 AND t.status = 'active'
            GROUP BY t.id
        `, [taskId]);
        
        if (taskInfo.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Задание не найдено или недоступно'
            });
        }
        
        const task = taskInfo.rows[0];
        const peopleRequired = task.people_required || 1;
        const completedCount = task.completed_count || 0;
        
        // 🔥 ПРОВЕРЯЕМ ДОСТИГНУТ ЛИ ЛИМИТ ИСПОЛНИТЕЛЕЙ
        if (completedCount >= peopleRequired) {
            return res.status(400).json({
                success: false,
                error: 'Достигнут лимит выполнения этого задания'
            });
        }
        
        // Start the task
        const result = await pool.query(`
            INSERT INTO user_tasks (user_id, task_id, status) 
            VALUES ($1, $2, 'active')
            RETURNING *
        `, [userId, taskId]);
        
        console.log('✅ Task started successfully:', result.rows[0]);
        
        res.json({
            success: true,
            message: 'Задание начато!',
            userTaskId: result.rows[0].id
        });
    } catch (error) {
        console.error('❌ Start task error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
// Get user tasks
app.get('/api/user/:userId/tasks', async (req, res) => {
    const userId = req.params.userId;
    const { status } = req.query;
    
    try {
        let query = `
            SELECT ut.*, t.title, t.description, t.price, t.category
            FROM user_tasks ut 
            JOIN tasks t ON ut.task_id = t.id 
            WHERE ut.user_id = $1
        `;
        let params = [userId];
        
        if (status) {
            query += " AND ut.status = $2";
            params.push(status);
        }
        
        query += " ORDER BY ut.started_at DESC";
        
        const result = await pool.query(query, params);
        
        res.json({
            success: true,
            tasks: result.rows
        });
    } catch (error) {
        console.error('Get user tasks error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
// Get user tasks for confirmation
app.get('/api/user/:userId/tasks/active', async (req, res) => {
    const userId = req.params.userId;
    
    try {
        const result = await pool.query(`
            SELECT ut.*, t.title, t.description, t.price, t.category
            FROM user_tasks ut 
            JOIN tasks t ON ut.task_id = t.id 
            WHERE ut.user_id = $1 AND ut.status = 'active'
            ORDER BY ut.started_at DESC
        `, [userId]);
        
        res.json({
            success: true,
            tasks: result.rows
        });
    } catch (error) {
        console.error('Get active tasks error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
// Submit task for verification (WITH FILE UPLOAD)
app.post('/api/user/tasks/:userTaskId/submit', upload.single('screenshot'), async (req, res) => {
    const userTaskId = req.params.userTaskId;
    const { userId } = req.body;
    
    if (!userId) {
        return res.status(400).json({
            success: false,
            error: 'Missing user ID'
        });
    }
    
    if (!req.file) {
        return res.status(400).json({
            success: false,
            error: 'No screenshot uploaded'
        });
    }
    
    const screenshotUrl = `/uploads/${req.file.filename}`;
    
    try {
        // Update user_task
        await pool.query(`
            UPDATE user_tasks 
            SET status = 'pending_review', screenshot_url = $1, submitted_at = CURRENT_TIMESTAMP 
            WHERE id = $2 AND user_id = $3
        `, [screenshotUrl, userTaskId, userId]);
        
        // Get task info for verification
        const taskInfo = await pool.query(`
            SELECT ut.user_id, ut.task_id, u.first_name, u.last_name, u.username, t.title, t.price 
            FROM user_tasks ut 
            JOIN user_profiles u ON ut.user_id = u.user_id 
            JOIN tasks t ON ut.task_id = t.id 
            WHERE ut.id = $1
        `, [userTaskId]);
        
        if (taskInfo.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Task not found'
            });
        }
        
        const taskData = taskInfo.rows[0];
        const userName = `${taskData.first_name} ${taskData.last_name}`;
        
        // Create verification record
        const verificationResult = await pool.query(`
            INSERT INTO task_verifications 
            (user_task_id, user_id, task_id, user_name, user_username, task_title, task_price, screenshot_url) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [userTaskId, taskData.user_id, taskData.task_id, userName, taskData.username, taskData.title, taskData.price, screenshotUrl]);
        
        res.json({
            success: true,
            message: 'Task submitted for review',
            verificationId: verificationResult.rows[0].id
        });
    } catch (error) {
        console.error('Submit task error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
// Обработчик ошибок подключения к БД
pool.on('error', (err, client) => {
    console.error('❌ Database connection error:', err);
    // Можно добавить логику переподключения
});

// Функция переподключения к БД
async function ensureDatabaseConnection() {
    try {
        await pool.query('SELECT 1');
        console.log('✅ Database connection verified');
        return true;
    } catch (error) {
        console.error('❌ Database connection lost:', error);
        // Можно добавить логику переподключения
        return false;
    }
}

// Проверяем подключение каждые 10 минут
setInterval(ensureDatabaseConnection, 10 * 60 * 1000);

// В server.js - обновите endpoint отмены задания
app.post('/api/user/tasks/:userTaskId/cancel', async (req, res) => {
    const userTaskId = req.params.userTaskId;
    const { userId } = req.body;
    
    if (!userId) {
        return res.status(400).json({
            success: false,
            error: 'Missing user ID'
        });
    }
    
    try {
        // Получаем информацию о задании перед удалением
        const taskInfo = await pool.query(`
            SELECT task_id FROM user_tasks 
            WHERE id = $1 AND user_id = $2 AND status = 'active'
        `, [userTaskId, userId]);
        
        if (taskInfo.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Задание не найдено или уже завершено'
            });
        }
        
        const taskId = taskInfo.rows[0].task_id;
        
        // Удаляем запись о выполнении задания
        await pool.query(`
            DELETE FROM user_tasks 
            WHERE id = $1 AND user_id = $2
        `, [userTaskId, userId]);
        
        console.log(`✅ Task ${taskId} cancelled by user ${userId}`);
        
        res.json({
            success: true,
            message: 'Задание отменено успешно',
            taskId: taskId
        });
    } catch (error) {
        console.error('Cancel task error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// ==================== SUPPORT CHAT ENDPOINTS ====================

// Get or create user chat - ИСПРАВЛЕННАЯ ВЕРСИЯ
app.get('/api/support/user-chat/:userId', async (req, res) => {
    const userId = req.params.userId;
    
    try {
        // Сначала проверяем существующий чат
        let chat = await pool.query(
            'SELECT * FROM support_chats WHERE user_id = $1', 
            [userId]
        );
        
        if (chat.rows.length === 0) {
            // Получаем информацию о пользователе
            const userResult = await pool.query(
                'SELECT first_name, last_name, username FROM user_profiles WHERE user_id = $1',
                [userId]
            );
            
            let user_name = 'Пользователь';
            let user_username = `user_${userId}`;
            
            if (userResult.rows.length > 0) {
                const user = userResult.rows[0];
                user_name = user.username ? `@${user.username}` : `User_${userId}`;
                user_username = user.username || user_username;
            }
            
            // Создаем новый чат
            chat = await pool.query(`
                INSERT INTO support_chats (user_id, user_name, user_username, last_message) 
                VALUES ($1, $2, $3, $4)
                RETURNING *
            `, [userId, user_name, user_username, 'Чат создан']);
            
            // Добавляем приветственное сообщение
            await pool.query(`
                INSERT INTO support_messages (chat_id, user_id, user_name, user_username, message, is_admin) 
                VALUES ($1, $2, $3, $4, $5, true)
            `, [chat.rows[0].id, ADMIN_ID, 'Администратор', 'linkgold_admin', 'Здравствуйте! Чем могу помочь?']);
        }
        
        res.json({
            success: true,
            chat: chat.rows[0]
        });
    } catch (error) {
        console.error('Get user chat error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Get chat messages
app.get('/api/support/chats/:chatId/messages', async (req, res) => {
    const chatId = req.params.chatId;
    
    try {
        const result = await pool.query(`
            SELECT * FROM support_messages 
            WHERE chat_id = $1 
            ORDER BY sent_at ASC
        `, [chatId]);
        
        res.json({
            success: true,
            messages: result.rows
        });
    } catch (error) {
        console.error('Get chat messages error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Send message to chat - ИСПРАВЛЕННАЯ ВЕРСИЯ
app.post('/api/support/chats/:chatId/messages', async (req, res) => {
    const chatId = req.params.chatId;
    const { user_id, user_name, user_username, message, is_admin } = req.body;

    if (!message) {
        return res.status(400).json({
            success: false,
            error: 'Message is required'
        });
    }

    try {
        // Save message
        const result = await pool.query(`
            INSERT INTO support_messages (chat_id, user_id, user_name, user_username, message, is_admin) 
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [chatId, user_id, user_name, user_username, message, is_admin || false]);

        // Update chat last message
        await pool.query(`
            UPDATE support_chats 
            SET last_message = $1, last_message_time = CURRENT_TIMESTAMP,
                unread_count = CASE WHEN $2 = true THEN 0 ELSE unread_count + 1 END
            WHERE id = $3
        `, [message, is_admin, chatId]);

        res.json({
            success: true,
            message: 'Message sent',
            messageId: result.rows[0].id
        });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Get all chats for admin (for all admins) - ИСПРАВЛЕННАЯ ВЕРСИЯ БЕЗ ПРОВЕРОК
app.get('/api/support/chats', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM support_chats 
            WHERE is_active = true
            ORDER BY last_message_time DESC
        `);
        
        res.json({
            success: true,
            chats: result.rows
        });
    } catch (error) {
        console.error('Get chats error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Get all chats (including archived) (for all admins) - ИСПРАВЛЕННАЯ ВЕРСИЯ БЕЗ ПРОВЕРОК
app.get('/api/support/all-chats', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM support_chats 
            ORDER BY last_message_time DESC
        `);
        
        res.json({
            success: true,
            chats: result.rows
        });
    } catch (error) {
        console.error('Get all chats error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Get archived chats (for all admins) - ИСПРАВЛЕННАЯ ВЕРСИЯ БЕЗ ПРОВЕРОК
app.get('/api/support/archived-chats', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM support_chats 
            WHERE is_active = false
            ORDER BY last_message_time DESC
        `);
        
        res.json({
            success: true,
            chats: result.rows
        });
    } catch (error) {
        console.error('Get archived chats error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Archive chat (for all admins) - ИСПРАВЛЕННАЯ ВЕРСИЯ БЕЗ ПРОВЕРОК
app.put('/api/support/chats/:chatId/archive', async (req, res) => {
    const chatId = req.params.chatId;
    
    try {
        await pool.query(`
            UPDATE support_chats 
            SET is_active = false 
            WHERE id = $1
        `, [chatId]);
        
        res.json({
            success: true,
            message: 'Chat archived successfully'
        });
    } catch (error) {
        console.error('Archive chat error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Restore chat (for all admins) - ИСПРАВЛЕННАЯ ВЕРСИЯ БЕЗ ПРОВЕРОК
app.put('/api/support/chats/:chatId/restore', async (req, res) => {
    const chatId = req.params.chatId;
    
    try {
        await pool.query(`
            UPDATE support_chats 
            SET is_active = true 
            WHERE id = $1
        `, [chatId]);
        
        res.json({
            success: true,
            message: 'Chat restored successfully'
        });
    } catch (error) {
        console.error('Restore chat error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// ==================== PROMOCODES ENDPOINTS ====================
// Временная функция для полного сброса таблицы промокодов
app.post('/api/admin/promocodes/reset', async (req, res) => {
    try {
        // Удаляем таблицу если существует
        await pool.query('DROP TABLE IF EXISTS promocodes CASCADE');
        await pool.query('DROP TABLE IF EXISTS promocode_activations CASCADE');
        
        // Создаем заново
        await createPromocodesTable();
        
        res.json({
            success: true,
            message: 'Таблицы промокодов полностью пересозданы'
        });
    } catch (error) {
        console.error('Reset promocodes error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/admin/promocodes/create', async (req, res) => {
    const { adminId, code, maxUses, reward, expiresAt } = req.body;
    
    console.log('🎫 Create promocode request:', { adminId, code, maxUses, reward, expiresAt });
    
    // Сначала проверяем и исправляем структуру таблицы
    await fixPromocodesTable();
    
    // Проверка прав - только главный админ
    if (!adminId || parseInt(adminId) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Только главный администратор может создавать промокоды!'
        });
    }
    
    // Валидация
    if (!code || !maxUses || !reward) {
        return res.status(400).json({
            success: false,
            error: 'Заполните все обязательные поля'
        });
    }
    
    try {
        // Проверяем существование промокода
        const existing = await pool.query(
            'SELECT id FROM promocodes WHERE code = $1 AND is_active = true',
            [code.toUpperCase()]
        );
        
        if (existing.rows.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Промокод с таким кодом уже существует!'
            });
        }
        
        // Создаем промокод
        const result = await pool.query(`
            INSERT INTO promocodes (code, max_uses, reward, expires_at, created_by) 
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [
            code.toUpperCase(), 
            parseInt(maxUses), 
            parseFloat(reward), 
            expiresAt ? new Date(expiresAt) : null, 
            adminId
        ]);
        
        console.log('✅ Promocode created:', result.rows[0]);
        
        res.json({
            success: true,
            message: `Промокод ${code} успешно создан!`,
            promocode: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ Create promocode error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка базы данных: ' + error.message
        });
    }
});

// ==================== ОТМЕНА ВЫПЛАТЫ ====================

// Endpoint для отмены выплаты и возврата средств пользователю
app.post('/api/admin/withdrawal-requests/:requestId/cancel', async (req, res) => {
    const requestId = req.params.requestId;
    const { adminId } = req.body;
    
    console.log('🔄 Отмена выплаты админом:', { requestId, adminId });
    
    // Проверка прав администратора
    const isAdmin = await checkAdminAccess(adminId);
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен. Только администраторы могут отменять выплаты.'
        });
    }
    
    try {
        // Получаем информацию о запросе на вывод
        const requestCheck = await pool.query(
            'SELECT * FROM withdrawal_requests WHERE id = $1',
            [requestId]
        );
        
        if (requestCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Запрос на вывод не найден'
            });
        }
        
        const withdrawalRequest = requestCheck.rows[0];
        
        // Проверяем, что запрос еще не обработан
        if (withdrawalRequest.status !== 'pending') {
            return res.status(400).json({
                success: false,
                error: 'Невозможно отменить уже обработанный запрос'
            });
        }
        
        // Начинаем транзакцию для безопасного возврата средств
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // 1. Возвращаем средства пользователю
            await client.query(`
                UPDATE user_profiles 
                SET balance = COALESCE(balance, 0) + $1
                WHERE user_id = $2
            `, [withdrawalRequest.amount, withdrawalRequest.user_id]);
            
            // 2. Обновляем статус запроса на "отменен"
            await client.query(`
                UPDATE withdrawal_requests 
                SET status = 'cancelled', 
                    completed_at = CURRENT_TIMESTAMP,
                    completed_by = $1
                WHERE id = $2
            `, [adminId, requestId]);
            
            await client.query('COMMIT');
            
            console.log(`✅ Выплата отменена! Средства возвращены пользователю ${withdrawalRequest.user_id}`);
            
            // Отправляем уведомление пользователю через бота
            if (bot) {
                try {
                    await bot.sendMessage(
                        withdrawalRequest.user_id,
                        `❌ Ваша заявка на вывод ${withdrawalRequest.amount}⭐ была отменена администратором. ` +
                        `Средства возвращены на ваш баланс.`
                    );
                } catch (botError) {
                    console.log('Не удалось отправить уведомление пользователю:', botError.message);
                }
            }
            
            res.json({
                success: true,
                message: `Выплата отменена! ${withdrawalRequest.amount}⭐ возвращены пользователю`,
                returnedAmount: withdrawalRequest.amount,
                userId: withdrawalRequest.user_id
            });
            
        } catch (transactionError) {
            await client.query('ROLLBACK');
            throw transactionError;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ Cancel withdrawal error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при отмене выплаты: ' + error.message
        });
    }
});

// ==================== ИСТОРИЯ ОТМЕНЕННЫХ ВЫПЛАТ ====================

// Получение истории отмененных выплат
app.get('/api/admin/cancelled-withdrawals', async (req, res) => {
    const { adminId } = req.query;
    
    console.log('📋 Запрос истории отмененных выплат от админа:', adminId);
    
    // Проверка прав администратора
    const isAdmin = await checkAdminAccess(adminId);
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен'
        });
    }
    
    try {
        const result = await pool.query(`
            SELECT wr.*, u.username, u.first_name, 
                   up.username as admin_username, up.first_name as admin_name
            FROM withdrawal_requests wr
            LEFT JOIN user_profiles u ON wr.user_id = u.user_id
            LEFT JOIN user_profiles up ON wr.completed_by = up.user_id
            WHERE wr.status = 'cancelled'
            ORDER BY wr.completed_at DESC
            LIMIT 50
        `);
        
        console.log(`✅ Найдено ${result.rows.length} отмененных выплат`);
        
        res.json({
            success: true,
            cancelledWithdrawals: result.rows
        });
    } catch (error) {
        console.error('❌ Get cancelled withdrawals error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Получение списка промокодов
app.get('/api/admin/promocodes/list', async (req, res) => {
    const { adminId } = req.query;
    
    // Только главный админ
    if (!adminId || parseInt(adminId) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Access denied'
        });
    }
    
    try {
        const result = await pool.query(`
            SELECT p.*, 
                   COUNT(pa.id) as used_count
            FROM promocodes p
            LEFT JOIN promocode_activations pa ON p.id = pa.promocode_id
            WHERE p.is_active = true
            GROUP BY p.id
            ORDER BY p.created_at DESC
        `);
        
        res.json({
            success: true,
            promocodes: result.rows
        });
        
    } catch (error) {
        console.error('Get promocodes error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Деактивация промокода
app.post('/api/admin/promocodes/deactivate', async (req, res) => {
    const { adminId, code } = req.body;
    
    // Только главный админ
    if (!adminId || parseInt(adminId) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Access denied'
        });
    }
    
    try {
        await pool.query(
            'UPDATE promocodes SET is_active = false WHERE code = $1',
            [code]
        );
        
        res.json({
            success: true,
            message: `Промокод ${code} успешно удален!`
        });
        
    } catch (error) {
        console.error('Deactivate promocode error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
// Получение данных задания для редактирования
app.get('/api/tasks/:taskId', async (req, res) => {
    const taskId = req.params.taskId;
    const adminId = req.query.adminId;
    
    try {
        // Проверяем права администратора
        const adminCheck = await pool.query(
            'SELECT is_admin FROM user_profiles WHERE user_id = $1',
            [adminId]
        );
        
        if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
            return res.status(403).json({
                success: false,
                error: 'Только администратор может редактировать задания'
            });
        }
        
        // Получаем данные задания
        const result = await pool.query(`
            SELECT * FROM tasks WHERE id = $1
        `, [taskId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Задание не найдено'
            });
        }
        
        res.json({
            success: true,
            task: result.rows[0]
        });
        
    } catch (error) {
        console.error('Get task error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка базы данных'
        });
    }
});

// Обновление задания
app.post('/api/tasks/:taskId/update', upload.single('image'), async (req, res) => {
    const taskId = req.params.taskId;
    const {
        title,
        description,
        price,
        category,
        time_to_complete,
        difficulty,
        people_required,
        task_url,
        adminId
    } = req.body;
    
    try {
        // Проверяем права администратора
        const adminCheck = await pool.query(
            'SELECT is_admin FROM user_profiles WHERE user_id = $1',
            [adminId]
        );
        
        if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
            return res.status(403).json({
                success: false,
                error: 'Только администратор может редактировать задания'
            });
        }
        
        // Проверяем существование задания
        const taskCheck = await pool.query(
            'SELECT * FROM tasks WHERE id = $1',
            [taskId]
        );
        
        if (taskCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Задание не найдено'
            });
        }
        
        // Подготавливаем данные для обновления
        let updateFields = [];
        let updateValues = [];
        let paramCount = 1;
        
        const fields = {
            'title': title,
            'description': description,
            'price': price,
            'category': category,
            'time_to_complete': time_to_complete,
            'difficulty': difficulty,
            'people_required': people_required,
            'task_url': task_url,
            'updated_at': new Date()
        };
        
        // Добавляем поля для обновления
        Object.keys(fields).forEach(field => {
            if (fields[field] !== undefined) {
                updateFields.push(`${field} = $${paramCount}`);
                updateValues.push(fields[field]);
                paramCount++;
            }
        });
        
        // Обрабатываем изображение если есть
        if (req.file) {
            const imageUrl = `/uploads/${req.file.filename}`;
            updateFields.push(`image_url = $${paramCount}`);
            updateValues.push(imageUrl);
            paramCount++;
        }
        
        // Добавляем ID задания в конец
        updateValues.push(taskId);
        
        // Выполняем обновление
        const updateQuery = `
            UPDATE tasks 
            SET ${updateFields.join(', ')}
            WHERE id = $${paramCount}
            RETURNING *
        `;
        
        const result = await pool.query(updateQuery, updateValues);
        
        res.json({
            success: true,
            message: 'Задание успешно обновлено',
            task: result.rows[0]
        });
        
    } catch (error) {
        console.error('Update task error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка базы данных'
        });
    }
});
// Активация промокода пользователем
app.post('/api/promocodes/activate', async (req, res) => {
    const { userId, code } = req.body;
    
    console.log('🎫 Activate promocode request:', { userId, code });
    
    if (!userId || !code) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields'
        });
    }
    
    try {
        // Проверяем существование пользователя
        const userResult = await pool.query(
            'SELECT user_id FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        // Проверяем промокод
        const promocodeResult = await pool.query(`
            SELECT * FROM promocodes 
            WHERE code = $1 AND is_active = true
        `, [code]);
        
        if (promocodeResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Промокод не найден или неактивен'
            });
        }
        
        const promocode = promocodeResult.rows[0];
        
        // Проверяем срок действия
        if (promocode.expires_at && new Date(promocode.expires_at) < new Date()) {
            return res.status(400).json({
                success: false,
                error: 'Срок действия промокода истек'
            });
        }
        
        // Проверяем лимит использований
        if (promocode.used_count >= promocode.max_uses) {
            return res.status(400).json({
                success: false,
                error: 'Лимит активаций промокода исчерпан'
            });
        }
        
        // Проверяем, активировал ли пользователь уже этот промокод
        const activationCheck = await pool.query(`
            SELECT pa.id 
            FROM promocode_activations pa
            JOIN promocodes p ON pa.promocode_id = p.id
            WHERE pa.user_id = $1 AND p.code = $2
        `, [userId, code]);
        
        if (activationCheck.rows.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Вы уже активировали этот промокод'
            });
        }
        
        // Начинаем транзакцию
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Добавляем запись об активации
            await client.query(`
                INSERT INTO promocode_activations (user_id, promocode_id) 
                VALUES ($1, $2)
            `, [userId, promocode.id]);
            
            // Обновляем счетчик использований
            await client.query(`
                UPDATE promocodes 
                SET used_count = used_count + 1 
                WHERE id = $1
            `, [promocode.id]);
            
            // Начисляем награду пользователю
            await client.query(`
                UPDATE user_profiles 
                SET balance = COALESCE(balance, 0) + $1
                WHERE user_id = $2
            `, [promocode.reward, userId]);
            
            await client.query('COMMIT');
            
            console.log(`✅ Promocode activated: user ${userId} got ${promocode.reward} stars`);
            
            res.json({
                success: true,
                message: `Промокод активирован! Вы получили ${promocode.reward} ⭐`,
                reward: promocode.reward
            });
            
        } catch (transactionError) {
            await client.query('ROLLBACK');
            throw transactionError;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ Activate promocode error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
// Получение статистики заданий для админ-панели
app.get('/api/admin/tasks-stats', async (req, res) => {
    const { adminId } = req.query;
    
    try {
        // Проверка прав администратора
        const isAdmin = await checkAdminAccess(adminId);
        if (!isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        // Получаем статистику по всем заданиям
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) as total_tasks,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_tasks,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks,
                COUNT(CASE WHEN created_by = $1 THEN 1 END) as my_tasks
            FROM tasks
        `, [adminId]);
        
        // Получаем статистику по user_tasks для счетчиков
        const userTasksStats = await pool.query(`
            SELECT 
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
                COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_count,
                COUNT(CASE WHEN status = 'pending_review' THEN 1 END) as pending_count,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_count
            FROM user_tasks
        `);
        
        const stats = statsResult.rows[0];
        const userStats = userTasksStats.rows[0];
        
        res.json({
            success: true,
            statistics: {
                total_tasks: parseInt(stats.total_tasks),
                active_tasks: parseInt(stats.active_tasks),
                completed_tasks: parseInt(stats.completed_tasks),
                my_tasks: parseInt(stats.my_tasks),
                // Добавляем счетчики из user_tasks
                completed_count: parseInt(userStats.completed_count),
                rejected_count: parseInt(userStats.rejected_count),
                pending_count: parseInt(userStats.pending_count),
                active_count: parseInt(userStats.active_count)
            }
        });
        
    } catch (error) {
        console.error('Get admin tasks stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
// Delete chat (for all admins) - ИСПРАВЛЕННАЯ ВЕРСИЯ БЕЗ ПРОВЕРОК
app.delete('/api/support/chats/:chatId', async (req, res) => {
    const chatId = req.params.chatId;
    
    try {
        // Delete messages first
        await pool.query(`
            DELETE FROM support_messages 
            WHERE chat_id = $1
        `, [chatId]);
        
        // Then delete chat
        await pool.query(`
            DELETE FROM support_chats 
            WHERE id = $1
        `, [chatId]);
        
        res.json({
            success: true,
            message: 'Chat deleted successfully'
        });
    } catch (error) {
        console.error('Delete chat error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Функция для отправки информации о пользователе
async function sendUserInfo(chatId, user) {
    const userName = user.first_name + (user.last_name ? ' ' + user.last_name : '');
    const userStatus = user.is_admin ? '👑 Администратор' : '👤 Пользователь';
    const registrationDate = new Date(user.created_at).toLocaleDateString('ru-RU');
    
    const messageText = `
👤 <b>Информация о пользователе</b>

<b>ID:</b> <code>${user.user_id}</code>
<b>Имя:</b> ${userName}
<b>Юзернейм:</b> @${user.username || 'не указан'}
<b>Статус:</b> ${userStatus}
<b>Баланс:</b> ${user.balance || 0}⭐
<b>Регистрация:</b> ${registrationDate}

📊 <b>Статистика заданий:</b>
• Всего заданий: ${user.total_tasks || 0}
• Выполнено: ${user.completed_tasks || 0}
• Отклонено: ${user.rejected_tasks || 0}
• На проверке: ${user.pending_tasks || 0}

👥 <b>Реферальная система:</b>
• Приглашено: ${user.referral_count || 0} чел.
• Заработано: ${user.referral_earned || 0}⭐
    `.trim();

    const keyboard = {
        inline_keyboard: [
            [
                {
                    text: user.is_admin ? '❌ Разжаловать' : '👑 Сделать админом',
                    callback_data: `toggle_admin_${user.user_id}`
                },
                {
                    text: user.balance > 0 ? '💳 Управление счетом' : '💰 Пополнить счет',
                    callback_data: `manage_balance_${user.user_id}`
                }
            ],
            [
                {
                    text: '🔄 Обновить',
                    callback_data: `refresh_user_${user.user_id}`
                },
                {
                    text: '📊 Подробная статистика',
                    callback_data: `user_stats_${user.user_id}`
                }
            ]
        ]
    };

    await bot.sendMessage(
        chatId,
        messageText,
        {
            parse_mode: 'HTML',
            reply_markup: keyboard
        }
    );
}
// ==================== TASK VERIFICATION ENDPOINTS ====================

// Система проверки заданий для ВСЕХ админов
app.get('/api/admin/task-verifications', async (req, res) => {
    const { adminId } = req.query;
    
    console.log('🔄 Запрос на проверку заданий от админа:', adminId);
    
    // Проверка прав администратора - РАЗРЕШАЕМ ВСЕМ АДМИНАМ
    const isAdmin = await checkAdminAccess(adminId);
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен. Только администраторы могут проверять задания.'
        });
    }
    
    try {
        const result = await pool.query(`
            SELECT tv.*, u.username, u.first_name, u.last_name
            FROM task_verifications tv 
            JOIN user_profiles u ON tv.user_id = u.user_id 
            WHERE tv.status = 'pending' 
            ORDER BY tv.submitted_at DESC
        `);
        
        console.log(`✅ Найдено ${result.rows.length} заданий на проверку для админа ${adminId}`);
        
        res.json({
            success: true,
            verifications: result.rows
        });
    } catch (error) {
        console.error('❌ Get verifications error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
// Диагностика прав администратора
app.get('/api/admin/debug-rights', async (req, res) => {
    const { userId } = req.query;
    
    console.log('🔍 Debug admin rights for user:', userId);
    
    try {
        const userResult = await pool.query(
            'SELECT user_id, username, is_admin FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            return res.json({
                success: false,
                error: 'User not found',
                isAdmin: false
            });
        }
        
        const user = userResult.rows[0];
        const isMainAdmin = parseInt(userId) === ADMIN_ID;
        const isAdmin = user.is_admin === true || isMainAdmin;
        
        res.json({
            success: true,
            user: user,
            isAdmin: isAdmin,
            isMainAdmin: isMainAdmin,
            adminId: ADMIN_ID
        });
        
    } catch (error) {
        console.error('Debug rights error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Автоматическая проверка реферальных начислений каждые 30 секунд
setInterval(() => {
    if (currentUser) {
        checkReferralEarnings();
    }
}, 30000);

app.post('/api/admin/task-verifications/:verificationId/approve', async (req, res) => {
    const { verificationId } = req.params;
    const { adminId, forceApprove = false } = req.body;

    console.log('🔄 Admin approving verification:', { verificationId, adminId, forceApprove });

    if (!adminId) {
        return res.status(400).json({
            success: false,
            error: 'ID администратора обязателен'
        });
    }

    try {
        const adminCheck = await pool.query(
            'SELECT is_admin FROM user_profiles WHERE user_id = $1',
            [adminId]
        );

        if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
            return res.status(403).json({
                success: false,
                error: 'Недостаточно прав. Только администратор может одобрять задания.'
            });
        }

        const verificationResult = await pool.query(`
            SELECT 
                tv.*,
                t.price as task_price,
                t.title as task_title,
                t.people_required,
                t.completed_count,
                ut.user_id,
                up.first_name as user_name,
                up.username,
                up.referred_by,
                up.tasks_completed
            FROM task_verifications tv
            JOIN user_tasks ut ON tv.user_task_id = ut.id
            JOIN tasks t ON ut.task_id = t.id
            JOIN user_profiles up ON ut.user_id = up.user_id
            WHERE tv.id = $1
        `, [verificationId]);

        if (verificationResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Проверка задания не найдена'
            });
        }

        const verification = verificationResult.rows[0];
        const userId = verification.user_id;
        const taskPrice = verification.task_price;
        const taskId = verification.task_id;
        const taskTitle = verification.task_title;
        const userTasksCompleted = verification.tasks_completed || 0;

        console.log('📊 Verification details:', {
            userId,
            taskPrice,
            taskTitle,
            peopleRequired: verification.people_required,
            completedCount: verification.completed_count,
            userTasksCompleted,
            hasScreenshot: !!verification.screenshot_url,
            referredBy: verification.referred_by
        });

        const userReward = Math.round(taskPrice * 0.9);
        const referralBonusAmount = taskPrice - userReward;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Обновляем статус user_task на 'completed'
            await client.query(
                'UPDATE user_tasks SET status = $1, completed_at = NOW() WHERE id = $2',
                ['completed', verification.user_task_id]
            );

            // 2. Начисляем 90% вознаграждения пользователю
            await client.query(
                'UPDATE user_profiles SET balance = balance + $1, tasks_completed = COALESCE(tasks_completed, 0) + 1 WHERE user_id = $2',
                [userReward, userId]
            );

            // 3. Обновляем счетчик выполненных заданий
            await client.query(
                'UPDATE tasks SET completed_count = COALESCE(completed_count, 0) + 1 WHERE id = $1',
                [taskId]
            );

            // 4. Помечаем верификацию как обработанную
            await client.query(
                'UPDATE task_verifications SET status = $1, reviewed_at = NOW(), reviewed_by = $2 WHERE id = $3',
                ['approved', adminId, verificationId]
            );

            // 🔥 ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ ПОЛЬЗОВАТЕЛЮ
            await sendTaskNotification(userId, taskTitle, 'approved');

            let referralBonus = null;
            
            if (verification.referred_by) {
                const referrerId = verification.referred_by;
                
                const referrerCheck = await client.query(
                    'SELECT user_id, first_name, username FROM user_profiles WHERE user_id = $1',
                    [referrerId]
                );

                if (referrerCheck.rows.length > 0) {
                    const referrer = referrerCheck.rows[0];
                    const bonusAmount = Math.round(taskPrice * 0.1);
                    
                    console.log('👥 Реферальная система:', {
                        referrerId: referrer.user_id,
                        referrerName: referrer.first_name,
                        taskPrice: taskPrice,
                        bonusAmount: bonusAmount,
                        calculation: `${taskPrice} * 10% = ${bonusAmount}`
                    });

                    await client.query(
                        `UPDATE user_profiles 
                         SET balance = balance + $1, 
                             referral_earned = COALESCE(referral_earned, 0) + $1
                         WHERE user_id = $2`,
                        [bonusAmount, referrerId]
                    );

                    referralBonus = {
                        referrerName: referrer.first_name || referrer.username || `User_${referrerId}`,
                        bonusAmount: bonusAmount,
                        referrerId: referrerId,
                        taskPrice: taskPrice,
                        userReward: userReward
                    };

                    console.log('✅ Реферальный бонус начислен:', referralBonus);

                    if (bot && referrerId !== adminId) {
                        try {
                            await bot.sendMessage(
                                referrerId,
                                `💰 <b>Реферальный доход!</b>\n\n` +
                                `Ваш реферал ${verification.user_name} выполнил задание!\n\n` +
                                `💫 Вы получили: <b>${bonusAmount}⭐</b> (10%)\n` +
                                `👤 Реферал получил: <b>${userReward}⭐</b> (90%)\n` +
                                `🎯 Задание: "${taskTitle}"`,
                                { parse_mode: 'HTML' }
                            );
                        } catch (botError) {
                            console.log('⚠️ Не удалось отправить уведомление рефереру:', botError.message);
                        }
                    }
                }
            }

            const taskUpdateResult = await client.query(
                'SELECT people_required, completed_count FROM tasks WHERE id = $1',
                [taskId]
            );

            let taskRemoved = false;
            if (taskUpdateResult.rows.length > 0) {
                const task = taskUpdateResult.rows[0];
                const peopleRequired = task.people_required || 1;
                const completedCount = task.completed_count || 0;

                if (completedCount >= peopleRequired) {
                    await client.query(
                        'UPDATE tasks SET status = $1 WHERE id = $2',
                        ['completed', taskId]
                    );
                    taskRemoved = true;
                    console.log('🎯 Task completed and removed:', taskId);
                }
            }

            await client.query('COMMIT');

            const response = {
                success: true,
                message: 'Задание успешно одобрено!',
                amountAdded: userReward,
                taskRemoved: taskRemoved,
                taskCompleted: true,
                userReward: userReward,
                originalPrice: taskPrice
            };

            if (referralBonus) {
                response.referralBonus = referralBonus;
                response.message += ` Реферальный бонус: ${referralBonus.bonusAmount}⭐`;
            }

            if (!verification.screenshot_url) {
                response.message += " (Одобрено без скриншота)";
            }

            console.log('✅ Verification approved successfully:', response);

            res.json(response);

        } catch (transactionError) {
            await client.query('ROLLBACK');
            console.error('❌ Transaction error:', transactionError);
            
            res.status(500).json({
                success: false,
                error: 'Внутренняя ошибка сервера'
            });
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('❌ Approve verification error:', error);
        
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера'
        });
    }
});

// Endpoint для получения обновленного списка проверок после одобрения
app.get('/api/admin/task-verifications/updated', async (req, res) => {
    const { adminId } = req.query;
    
    console.log('🔄 Запрос обновленного списка проверок от админа:', adminId);
    
    // Проверка прав администратора
    const isAdmin = await checkAdminAccess(adminId);
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен'
        });
    }
    
    try {
        const result = await pool.query(`
            SELECT tv.*, u.username, u.first_name, u.last_name
            FROM task_verifications tv 
            JOIN user_profiles u ON tv.user_id = u.user_id 
            WHERE tv.status = 'pending' 
            ORDER BY tv.submitted_at DESC
        `);
        
        console.log(`✅ Обновленный список: ${result.rows.length} заданий на проверку`);
        
        res.json({
            success: true,
            verifications: result.rows,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Get updated verifications error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// 🔧 ENDPOINT ДЛЯ ПРИНУДИТЕЛЬНОГО ОДОБРЕНИЯ БЕЗ СКРИНШОТА
app.post('/api/admin/task-verifications/:verificationId/force-approve', async (req, res) => {
    const { verificationId } = req.params;
    const { adminId, reason } = req.body;

    console.log('🔧 Force approving verification:', { verificationId, adminId, reason });

    try {
        // Используем основную функцию с флагом forceApprove
        const result = await pool.query(`
            SELECT tv.*, ut.user_id, t.price, t.id as task_id
            FROM task_verifications tv
            JOIN user_tasks ut ON tv.user_task_id = ut.id
            JOIN tasks t ON ut.task_id = t.id
            WHERE tv.id = $1
        `, [verificationId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Проверка не найдена'
            });
        }

        const verification = result.rows[0];

        // Вызываем основной endpoint с флагом forceApprove
        const approveResult = await fetch(`http://localhost:${PORT}/api/admin/task-verifications/${verificationId}/approve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                adminId: adminId,
                forceApprove: true
            })
        });

        const data = await approveResult.json();

        if (data.success) {
            // Логируем принудительное одобрение
            await pool.query(`
                INSERT INTO admin_actions (admin_id, action_type, target_id, description) 
                VALUES ($1, $2, $3, $4)
            `, [adminId, 'force_approve', verificationId, reason || 'Автоматическое одобрение при ошибке скриншота']);

            res.json({
                success: true,
                message: 'Задание одобрено в принудительном режиме',
                ...data
            });
        } else {
            throw new Error(data.error);
        }

    } catch (error) {
        console.error('❌ Force approve error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка принудительного одобрения: ' + error.message
        });
    }
});
// В server.js добавьте:
app.get('/api/user/:userId/referral-earnings', async (req, res) => {
    const userId = req.params.userId;
    
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as referral_count,
                COALESCE(SUM(referral_earned), 0) as total_earned
            FROM user_profiles 
            WHERE user_id = $1
        `, [userId]);
        
        res.json({
            success: true,
            earnings: result.rows[0]
        });
    } catch (error) {
        console.error('Get referral earnings error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error'
        });
    }
});
// 🗑️ РУЧНОЕ УДАЛЕНИЕ ПРОВЕРКИ ЗАДАНИЯ
// 🗑️ РУЧНОЕ УДАЛЕНИЕ ПРОВЕРКИ ЗАДАНИЯ
app.post('/api/admin/task-verifications/:verificationId/delete', async (req, res) => {
    const verificationId = req.params.verificationId;
    const { adminId } = req.body;
    
    console.log('🗑️ Ручное удаление проверки задания:', { verificationId, adminId });
    
    // Проверка прав администратора
    const isAdmin = await checkAdminAccess(adminId);
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен. Только администраторы могут удалять проверки.'
        });
    }
    
    try {
        // Получаем информацию о проверке
        const verification = await pool.query(
            'SELECT * FROM task_verifications WHERE id = $1', 
            [verificationId]
        );
        
        if (verification.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Проверка не найдена'
            });
        }

        const verificationData = verification.rows[0];
        
        // Удаляем запись проверки
        await pool.query('DELETE FROM task_verifications WHERE id = $1', [verificationId]);
        
        // Обновляем статус user_task обратно на 'active'
        await pool.query(`
            UPDATE user_tasks 
            SET status = 'active', submitted_at = NULL, screenshot_url = NULL
            WHERE id = $1
        `, [verificationData.user_task_id]);
        
        console.log(`✅ Проверка ${verificationId} удалена, задание возвращено в активные`);
        
        res.json({
            success: true,
            message: 'Проверка успешно удалена, задание возвращено пользователю для повторной отправки'
        });
        
    } catch (error) {
        console.error('Delete verification error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});


// Отклонение задания для ВСЕХ админов - ОБНОВЛЕННАЯ ВЕРСИЯ С УДАЛЕНИЕМ ФАЙЛОВ
app.post('/api/admin/task-verifications/:verificationId/reject', async (req, res) => {
    const verificationId = req.params.verificationId;
    const { adminId, comment = '' } = req.body;
    
    console.log(' ❌ Отклонение задания админом:', { verificationId, adminId, comment });
    
    const isAdmin = await checkAdminAccess(adminId);
    if (!isAdmin) {
        return res.status(403).json({
            success: false,
            error: 'Доступ запрещен. Только администраторы могут отклонять задания.'
        });
    }
    
    let screenshotPath = '';
    
    try {
        const verification = await pool.query(`
            SELECT tv.*, t.title as task_title, ut.user_id 
            FROM task_verifications tv
            JOIN user_tasks ut ON tv.user_task_id = ut.id
            JOIN tasks t ON ut.task_id = t.id
            WHERE tv.id = $1
        `, [verificationId]);
        
        if (verification.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Verification not found'
            });
        }

        const verificationData = verification.rows[0];
        const userId = verificationData.user_id;
        const taskTitle = verificationData.task_title;
        
        screenshotPath = verificationData.screenshot_url;
        
        await pool.query(`
            UPDATE task_verifications 
            SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = $1 
            WHERE id = $2
        `, [adminId, verificationId]);
        
        await pool.query(`
            UPDATE user_tasks 
            SET status = 'rejected', completed_at = CURRENT_TIMESTAMP 
            WHERE id = $1
        `, [verificationData.user_task_id]);
        
        // 🔥 ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ ОБ ОТКЛОНЕНИИ
        await sendTaskNotification(userId, taskTitle, 'rejected', comment);
        
        if (screenshotPath) {
            await deleteScreenshotFile(screenshotPath);
        }
        
        res.json({
            success: true,
            message: 'Задание отклонено'
        });
    } catch (error) {
        console.error('Reject verification error:', error);
        
        if (screenshotPath) {
            try {
                await deleteScreenshotFile(screenshotPath);
            } catch (deleteError) {
                console.error('Error deleting screenshot after failed rejection:', deleteError);
            }
        }
        
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
// 🔧 ФУНКЦИЯ ДЛЯ УДАЛЕНИЯ ФАЙЛОВ СКРИНШОТОВ
async function deleteScreenshotFile(screenshotUrl) {
    try {
        // Извлекаем имя файла из URL
        const filename = screenshotUrl.split('/').pop();
        if (!filename) {
            console.log('❌ Cannot extract filename from URL:', screenshotUrl);
            return;
        }
        
        const filePath = path.join(__dirname, 'uploads', filename);
        
        // Проверяем существование файла
        if (fs.existsSync(filePath)) {
            // Удаляем файл
            fs.unlinkSync(filePath);
            console.log(`✅ Screenshot file deleted: ${filename}`);
            
            // Также удаляем запись из базы данных о скриншоте
            await pool.query(`
                UPDATE user_tasks 
                SET screenshot_url = NULL 
                WHERE screenshot_url LIKE $1
            `, [`%${filename}%`]);
            
        } else {
            console.log(`⚠️ File not found, skipping deletion: ${filename}`);
        }
    } catch (error) {
        console.error('❌ Error deleting screenshot file:', error);
        // Не бросаем ошибку дальше, чтобы не нарушить основной процесс
    }
}
// ==================== WITHDRAWAL ENDPOINTS ====================

// Request withdrawal - ОБНОВЛЕННАЯ ВЕРСИЯ С ПРОВЕРКОЙ МИНИМУМА
app.post('/api/withdrawal/request', async (req, res) => {
    const { user_id, amount, username, first_name } = req.body;
    
    console.log('📨 Получен запрос на вывод:', { user_id, amount, username, first_name });
    
    if (!user_id || !amount) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields'
        });
    }
    
    try {
        const MIN_WITHDRAWAL = 250; // Минимальная сумма вывода
        
        // Проверяем баланс пользователя
        const userResult = await pool.query(
            'SELECT balance FROM user_profiles WHERE user_id = $1',
            [user_id]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const userBalance = parseFloat(userResult.rows[0].balance) || 0;
        const requestAmount = parseFloat(amount);
        
        console.log(`💰 Баланс пользователя: ${userBalance}, Запрошено: ${requestAmount}`);
        
        // Проверка минимальной суммы
        if (requestAmount < MIN_WITHDRAWAL) {
            return res.status(400).json({
                success: false,
                error: `Минимальная сумма для вывода: ${MIN_WITHDRAWAL} ⭐`
            });
        }
        
        if (requestAmount > userBalance) {
            return res.status(400).json({
                success: false,
                error: 'Недостаточно средств на балансе'
            });
        }
        
        if (requestAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Сумма должна быть положительной'
            });
        }
        
        // Обнуляем баланс пользователя
        await pool.query(
            'UPDATE user_profiles SET balance = 0 WHERE user_id = $1',
            [user_id]
        );
        
        // Создаем запрос на вывод
        const result = await pool.query(`
            INSERT INTO withdrawal_requests (user_id, username, first_name, amount, status) 
            VALUES ($1, $2, $3, $4, 'pending')
            RETURNING *
        `, [user_id, username, first_name, requestAmount]);
        
        const requestId = result.rows[0].id;
        
        console.log(`✅ Запрос на вывод создан: ID ${requestId}`);
        
        res.json({
            success: true,
            message: 'Запрос на вывод отправлен',
            requestId: requestId,
            newBalance: 0
        });
        
    } catch (error) {
        console.error('❌ Withdrawal error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Get withdrawal history
app.get('/api/withdraw/history/:userId', async (req, res) => {
    const userId = req.params.userId;
    
    try {
        const result = await pool.query(`
            SELECT * FROM withdrawal_requests 
            WHERE user_id = $1 
            ORDER BY created_at DESC
        `, [userId]);
        
        res.json({
            success: true,
            operations: result.rows
        });
    } catch (error) {
        console.error('Get withdrawal history error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// ==================== ADMIN MANAGEMENT ENDPOINTS ====================
// В server.js
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});
// Получение списка всех админов с расширенной статистикой
app.get('/api/admin/admins-list', async (req, res) => {
    const { adminId } = req.query;
    
    console.log('🔄 Loading admins list for admin:', adminId);
    
    if (!adminId || parseInt(adminId) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Access denied - only main admin can view admins list'
        });
    }
    
    try {
        // Сначала убедимся, что таблица существует
        await createAdminPermissionsTable();
        
        const result = await pool.query(`
            SELECT 
                up.user_id, 
                up.username, 
                up.first_name, 
                up.last_name, 
                up.is_admin,
                up.created_at,
                -- Статистика постов
                (SELECT COUNT(*) FROM posts WHERE author_id = up.user_id) as posts_count,
                -- Статистика заданий
                (SELECT COUNT(*) FROM tasks WHERE created_by = up.user_id) as tasks_count,
                -- Статистика проверок
                (SELECT COUNT(*) FROM task_verifications WHERE reviewed_by = up.user_id) as verifications_count,
                -- Статистика поддержки
                (SELECT COUNT(*) FROM support_messages WHERE user_id = up.user_id AND is_admin = true) as support_count,
                -- Статистика выплат
                (SELECT COUNT(*) FROM withdrawal_requests WHERE completed_by = up.user_id) as payments_count,
                -- Права доступа (используем COALESCE для обработки NULL значений)
                COALESCE(ap.can_posts, true) as can_posts,
                COALESCE(ap.can_tasks, true) as can_tasks,
                COALESCE(ap.can_verification, true) as can_verification,
                COALESCE(ap.can_support, true) as can_support,
                COALESCE(ap.can_payments, true) as can_payments
            FROM user_profiles up
            LEFT JOIN admin_permissions ap ON up.user_id = ap.admin_id
            WHERE up.is_admin = true 
            ORDER BY 
                CASE WHEN up.user_id = $1 THEN 0 ELSE 1 END,
                up.created_at DESC
        `, [ADMIN_ID]);
        
        console.log(`✅ Found ${result.rows.length} admins`);
        
        res.json({
            success: true,
            admins: result.rows
        });
        
    } catch (error) {
        console.error('❌ Get admins list error:', error);
        
        // Если все еще есть ошибка с таблицей, попробуем упрощенный запрос
        if (error.message.includes('admin_permissions')) {
            try {
                console.log('🔄 Trying simplified query without admin_permissions...');
                
                const simpleResult = await pool.query(`
                    SELECT 
                        user_id, 
                        username, 
                        first_name, 
                        last_name, 
                        is_admin,
                        created_at
                    FROM user_profiles 
                    WHERE is_admin = true 
                    ORDER BY 
                        CASE WHEN user_id = $1 THEN 0 ELSE 1 END,
                        created_at DESC
                `, [ADMIN_ID]);
                
                // Добавляем дефолтные права
                const adminsWithDefaults = simpleResult.rows.map(admin => ({
                    ...admin,
                    can_posts: true,
                    can_tasks: true,
                    can_verification: true,
                    can_support: true,
                    can_payments: true,
                    posts_count: 0,
                    tasks_count: 0,
                    verifications_count: 0,
                    support_count: 0,
                    payments_count: 0
                }));
                
                return res.json({
                    success: true,
                    admins: adminsWithDefaults,
                    note: 'Using simplified query'
                });
            } catch (fallbackError) {
                console.error('❌ Fallback query also failed:', fallbackError);
            }
        }
        
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Диагностический endpoint для заданий
app.get('/api/debug/tasks-detailed', async (req, res) => {
    const { userId } = req.query;
    
    try {
        // Получаем все активные задания
        const tasksResult = await pool.query(`
            SELECT t.*, 
                   COUNT(ut.id) as completed_count,
                   EXISTS(
                       SELECT 1 FROM user_tasks ut2 
                       WHERE ut2.task_id = t.id 
                       AND ut2.user_id = $1 
                       AND ut2.status IN ('active', 'pending_review', 'completed')
                   ) as user_has_task
            FROM tasks t 
            LEFT JOIN user_tasks ut ON t.id = ut.task_id AND ut.status = 'completed'
            WHERE t.status = 'active'
            GROUP BY t.id 
            ORDER BY t.created_at DESC
        `, [userId]);
        
        // Получаем задания пользователя
        const userTasksResult = await pool.query(`
            SELECT task_id FROM user_tasks 
            WHERE user_id = $1 AND status IN ('active', 'pending_review', 'completed')
        `, [userId]);
        
        const userTaskIds = userTasksResult.rows.map(row => row.task_id);
        
        // Фильтруем доступные задания
        const availableTasks = tasksResult.rows.filter(task => {
            const completedCount = task.completed_count || 0;
            const peopleRequired = task.people_required || 1;
            const isAvailableByLimit = completedCount < peopleRequired;
            const isAvailableToUser = !userTaskIds.includes(task.id);
            
            return isAvailableByLimit && isAvailableToUser;
        });
        
        res.json({
            success: true,
            debug: {
                total_tasks: tasksResult.rows.length,
                user_task_ids: userTaskIds,
                available_tasks_count: availableTasks.length,
                user_id: userId
            },
            all_tasks: tasksResult.rows,
            available_tasks: availableTasks
        });
        
    } catch (error) {
        console.error('Debug tasks error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Создание таблицы прав администраторов
async function createAdminPermissionsTable() {
    try {
        console.log('🔧 Creating admin_permissions table...');
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_permissions (
                admin_id BIGINT PRIMARY KEY,
                can_posts BOOLEAN DEFAULT true,
                can_tasks BOOLEAN DEFAULT true,
                can_verification BOOLEAN DEFAULT true,
                can_support BOOLEAN DEFAULT true,
                can_payments BOOLEAN DEFAULT true,
                can_admins BOOLEAN DEFAULT false,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (admin_id) REFERENCES user_profiles(user_id)
            )
        `);
        
        // Устанавливаем права по умолчанию для главного админа
        await pool.query(`
            INSERT INTO admin_permissions (admin_id, can_posts, can_tasks, can_verification, can_support, can_payments, can_admins)
            VALUES ($1, true, true, true, true, true, true)
            ON CONFLICT (admin_id) DO NOTHING
        `, [ADMIN_ID]);
        
        console.log('✅ admin_permissions table created/verified');
    } catch (error) {
        console.error('❌ Error creating admin_permissions table:', error);
    }
}
// Расширенная проверка прав администратора
async function checkAdminPermission(userId, permission) {
    try {
        // Главный админ имеет все права
        if (parseInt(userId) === ADMIN_ID) {
            return true;
        }
        
        // Проверяем базовые права администратора
        const adminCheck = await pool.query(
            'SELECT is_admin FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        if (adminCheck.rows.length === 0 || !adminCheck.rows[0].is_admin) {
            return false;
        }
        
        // Проверяем конкретные права в таблице разрешений
        const permissionResult = await pool.query(
            `SELECT ${permission} FROM admin_permissions WHERE admin_id = $1`,
            [userId]
        );
        
        // Если запись не найдена, даем доступ по умолчанию
        if (permissionResult.rows.length === 0) {
            return true;
        }
        
        return permissionResult.rows[0][permission] === true;
    } catch (error) {
        console.error('Permission check error:', error);
        return false;
    }
}

// Обновление прав доступа админа
app.post('/api/admin/update-permissions', async (req, res) => {
    const { adminId, targetAdminId, permission, enabled } = req.body;
    
    // Только главный админ может управлять правами
    if (!adminId || parseInt(adminId) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Access denied - only main admin can update permissions'
        });
    }
    
    try {
        const columnMap = {
            'posts': 'can_posts',
            'tasks': 'can_tasks', 
            'verification': 'can_verification',
            'support': 'can_support',
            'payments': 'can_payments',
            'admins': 'can_admins'
        };
        
        const column = columnMap[permission];
        if (!column) {
            return res.status(400).json({
                success: false,
                error: 'Invalid permission type'
            });
        }
        
        await pool.query(`
            INSERT INTO admin_permissions (admin_id, ${column})
            VALUES ($1, $2)
            ON CONFLICT (admin_id)
            DO UPDATE SET ${column} = $2, updated_at = CURRENT_TIMESTAMP
        `, [targetAdminId, enabled]);
        
        res.json({
            success: true,
            message: 'Права доступа обновлены'
        });
        
    } catch (error) {
        console.error('Update permissions error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
app.post('/api/admin/add-admin', async (req, res) => {
    const { adminId, username } = req.body;
    
    console.log('🛠️ Add admin request:', { adminId, username });
    
    try {
        // Проверяем, что запрос от главного админа
        if (parseInt(adminId) !== 8036875641) {
            return res.status(403).json({
                success: false,
                error: 'Только главный администратор может добавлять админов!'
            });
        }
        
        if (!username || username.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Username не может быть пустым!'
            });
        }
        
        // Очищаем username (убираем @ если есть)
        const cleanUsername = username.replace('@', '').trim();
        
        console.log('🔍 Searching for user with username:', cleanUsername);
        
        // Ищем пользователя по username
        const userResult = await pool.query(
            'SELECT user_id, first_name, last_name, username, is_admin FROM user_profiles WHERE username = $1',
            [cleanUsername]
        );
        
        if (userResult.rows.length === 0) {
            console.log('❌ User not found with username:', cleanUsername);
            return res.status(404).json({
                success: false,
                error: `Пользователь с username "${cleanUsername}" не найден! 
                
Убедитесь, что:
1. Пользователь зарегистрирован в боте @LinkGoldMoney_bot
2. Вы правильно ввели username (без @)
3. Пользователь выполнил команду /start в боте`
            });
        }
        
        const targetUser = userResult.rows[0];
        
        // Проверяем, не является ли пользователь уже админом
        if (targetUser.is_admin) {
            return res.status(400).json({
                success: false,
                error: `Пользователь ${targetUser.first_name} (@${targetUser.username}) уже является администратором!`
            });
        }
        
        console.log('✅ Found user:', targetUser);
        
        // Делаем пользователя админом
        await pool.query(
            'UPDATE user_profiles SET is_admin = true WHERE user_id = $1',
            [targetUser.user_id]
        );
        
        // Добавляем права доступа по умолчанию
        try {
            await pool.query(`
                INSERT INTO admin_permissions (admin_id, can_posts, can_tasks, can_verification, can_support, can_payments)
                VALUES ($1, true, true, true, true, true)
                ON CONFLICT (admin_id) DO UPDATE SET 
                    can_posts = true,
                    can_tasks = true,
                    can_verification = true,
                    can_support = true,
                    can_payments = true,
                    updated_at = CURRENT_TIMESTAMP
            `, [targetUser.user_id]);
        } catch (permsError) {
            console.log('⚠️ Could not set admin permissions:', permsError.message);
            // Продолжаем без прав доступа - они установятся по умолчанию
        }
        
        console.log(`✅ User ${targetUser.username} (ID: ${targetUser.user_id}) promoted to admin`);
        
        // Отправляем уведомление пользователю через бота (если бот активен)
        if (bot) {
            try {
                await bot.sendMessage(
                    targetUser.user_id,
                    `🎉 <b>Поздравляем!</b>\n\n` +
                    `Вы были назначены администратором в LinkGold!\n\n` +
                    `Теперь у вас есть доступ к:\n` +
                    `• 📝 Управлению постами\n` +
                    `• 📋 Созданию заданий\n` +
                    `• ✅ Проверке заданий\n` +
                    `• 💬 Поддержке пользователей\n` +
                    `• 💳 Управлению выплатами\n\n` +
                    `Для доступа к панели администратора откройте приложение LinkGold.`,
                    { parse_mode: 'HTML' }
                );
            } catch (botError) {
                console.log('⚠️ Could not send notification to new admin:', botError.message);
            }
        }
        
        res.json({
            success: true,
            message: `Пользователь ${targetUser.first_name} (@${targetUser.username}) успешно добавлен как администратор!`,
            targetUserId: targetUser.user_id,
            user: {
                id: targetUser.user_id,
                username: targetUser.username,
                firstName: targetUser.first_name
            }
        });
        
    } catch (error) {
        console.error('❌ Add admin error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка базы данных: ' + error.message
        });
    }
});
// Поиск пользователя по username (для проверки)
app.get('/api/admin/find-user/:username', async (req, res) => {
    const username = req.params.username;
    
    try {
        const cleanUsername = username.replace('@', '').trim();
        
        const userResult = await pool.query(
            'SELECT user_id, username, first_name, last_name, is_admin, created_at FROM user_profiles WHERE username = $1',
            [cleanUsername]
        );
        
        if (userResult.rows.length === 0) {
            return res.json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const user = userResult.rows[0];
        
        res.json({
            success: true,
            user: user,
            message: `Найден пользователь: ${user.first_name} (@${user.username})`
        });
        
    } catch (error) {
        console.error('Find user error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});
// Тестовый endpoint для проверки
app.post('/api/test-admin', async (req, res) => {
    console.log('🧪 Test admin endpoint called:', req.body);
    
    try {
        res.json({
            success: true,
            message: 'Test endpoint works!',
            received_data: req.body,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Test endpoint error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Диагностический endpoint для проверки доступности
app.get('/api/admin/debug', (req, res) => {
    console.log('🔍 Admin debug endpoint hit');
    res.json({
        success: true,
        message: 'Admin endpoints are working!',
        timestamp: new Date().toISOString(),
        endpoints: {
            'POST /api/admin/add-admin': 'Add new admin',
            'GET /api/admin/admins-list': 'Get admins list', 
            'POST /api/admin/remove-admin': 'Remove admin'
        }
    });
});

// Простой тестовый endpoint для добавления админа
app.post('/api/admin/test-add', (req, res) => {
    console.log('🧪 Test add admin endpoint called:', req.body);
    
    const { adminId, username } = req.body;
    
    if (!adminId || !username) {
        return res.status(400).json({
            success: false,
            error: 'Missing adminId or username'
        });
    }
    
    res.json({
        success: true,
        message: 'Test endpoint works!',
        received: {
            adminId: adminId,
            username: username
        },
        timestamp: new Date().toISOString()
    });
});

// Проверка существования всех admin endpoints
app.get('/api/admin/endpoints-check', (req, res) => {
    const endpoints = [
        '/api/admin/add-admin',
        '/api/admin/admins-list', 
        '/api/admin/remove-admin',
        '/api/admin/test-add',
        '/api/admin/debug'
    ];
    
    res.json({
        success: true,
        endpoints: endpoints,
        serverTime: new Date().toISOString()
    });
});
// Удаление админа (только для главного админа)
app.post('/api/admin/remove-admin', async (req, res) => {
    const { adminId, targetAdminId } = req.body;
    
    console.log('🛠️ Received remove-admin request:', { adminId, targetAdminId });
    
    // Проверяем права доступа - только главный админ
    if (!adminId || parseInt(adminId) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Access denied - only main admin can remove admins'
        });
    }
    
    if (!targetAdminId) {
        return res.status(400).json({
            success: false,
            error: 'Target admin ID is required'
        });
    }
    
    // Нельзя удалить самого себя
    if (parseInt(targetAdminId) === ADMIN_ID) {
        return res.status(400).json({
            success: false,
            error: 'Нельзя удалить главного администратора'
        });
    }
    
    try {
        // Проверяем существование пользователя
        const userResult = await pool.query(
            'SELECT user_id, username, first_name, is_admin FROM user_profiles WHERE user_id = $1',
            [targetAdminId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const user = userResult.rows[0];
        
        if (!user.is_admin) {
            return res.status(400).json({
                success: false,
                error: 'Этот пользователь не является администратором'
            });
        }
        
        // Удаляем права админа
        await pool.query(
            'UPDATE user_profiles SET is_admin = false WHERE user_id = $1',
            [targetAdminId]
        );
        
        console.log(`✅ Admin removed: ${user.username} (ID: ${user.user_id})`);
        
        res.json({
            success: true,
            message: `Администратор @${user.username} (${user.first_name}) успешно удален`,
            user: {
                id: user.user_id,
                username: user.username,
                firstName: user.first_name
            }
        });
        
    } catch (error) {
        console.error('❌ Remove admin error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Принудительное обновление прав администратора
app.post('/api/admin/refresh-rights', async (req, res) => {
    const { userId } = req.body;
    
    try {
        // Получаем актуальные данные пользователя из базы
        const userResult = await pool.query(
            'SELECT * FROM user_profiles WHERE user_id = $1',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const user = userResult.rows[0];
        
        res.json({
            success: true,
            user: user,
            message: 'Admin rights refreshed'
        });
        
    } catch (error) {
        console.error('Refresh rights error:', error);
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// ==================== DEBUG ENDPOINTS ====================

// Debug endpoint to check database state
app.get('/api/debug/tables', async (req, res) => {
    try {
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        
        const results = {};
        for (let table of tables.rows) {
            const tableName = table.table_name;
            const countResult = await pool.query(`SELECT COUNT(*) FROM ${tableName}`);
            results[tableName] = {
                count: parseInt(countResult.rows[0].count),
                sample: countResult.rows[0].count > 0 ? 
                    (await pool.query(`SELECT * FROM ${tableName} LIMIT 3`)).rows : []
            };
        }
        
        res.json({
            success: true,
            tables: results
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// В начале server.js, после инициализации pool
async function checkDatabaseConnection() {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Database connection successful:', result.rows[0]);
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error);
        return false;
    }
}
// Diagnostic endpoint
app.get('/api/debug/endpoints', async (req, res) => {
    try {
        const routes = [];
        app._router.stack.forEach(middleware => {
            if (middleware.route) {
                routes.push({
                    path: middleware.route.path,
                    methods: Object.keys(middleware.route.methods)
                });
            } else if (middleware.name === 'router') {
                middleware.handle.stack.forEach(handler => {
                    if (handler.route) {
                        routes.push({
                            path: handler.route.path,
                            methods: Object.keys(handler.route.methods)
                        });
                    }
                });
            }
        });

        res.json({
            success: true,
            endpoints: routes,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Debug endpoints error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Main route - serve index.html for all other routes (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('❌ Server error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error: ' + err.message
    });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'API endpoint not found'
    });
});

// Замените текущий app.listen на этот:
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/api/health`);
    console.log(`🔐 Admin ID: ${ADMIN_ID}`);
    
    // Инициализируем базу данных с заданиями
    await initializeWithTasks();
    
    // Принудительно исправляем структуру таблиц
    try {
        await fixWithdrawalTable();
        await fixTasksTable();
        await fixReferralLinksTable(); // Добавьте эту строку
        console.log('✅ All table structures verified');
    } catch (error) {
        console.error('❌ Error fixing table structures:', error);
    }
});