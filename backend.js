require('dotenv').config(); // Загружаем переменные окружения из .env
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { MongoClient, ServerApiVersion } = require('mongodb');

// Настройки приложения
const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const PORT = process.env.PORT || 3000; // Берем порт из переменной окружения

// Замените на ваш реальный токен бота (лучше хранить в .env)
const botToken = process.env.BOT_TOKEN;

// Строка подключения к MongoDB (из .env)
const uri = process.env.MONGODB_URI;

// Создаем клиент MongoDB
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// Подключаемся к MongoDB
async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("Connected to MongoDB!");
        // Проверка соединения
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } catch (err) {
        console.error('MongoDB connection error:', err);
        process.exit(1); // Выход из процесса при ошибке подключения
    }
}

connectToMongoDB();

// Middleware для обработки JSON
app.use(express.json());

// Middleware для статических файлов
app.use(express.static('public'));

// Функция проверки подписи данных из Telegram Web App
function checkSignature(initData, botToken) {
    const crypto = require('crypto');
    const data = new URLSearchParams(initData);
    const hash = data.get('hash');
    data.delete('hash');

    const dataCheckString = Array.from(data.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData') // Секретный ключ "WebAppData"
        .update(botToken) // Используем токен бота
        .digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

    return calculatedHash === hash;
}

// Socket.IO обработчики событий
io.on('connection', (socket) => {
    console.log('Новый пользователь подключился:', socket.id);

    // Аутентификация через Telegram Web App
    socket.on('authenticate', (data) => {
        const { initData } = data;

        if (checkSignature(initData, botToken)) {
            try { // Добавляем try...catch
                const initDataParams = new URLSearchParams(initData);
                if(Date.now()/1000 - initDataParams.get('auth_date') > 86400)
                {
                    //initData устарела, более суток.
                     console.log('Ошибка аутентификации: initData устарела.');
                     socket.emit('auth-failed', {message: 'Authentication failed: initData expired.'});
                     socket.disconnect(true);
                     return;
                }
                const user = JSON.parse(decodeURIComponent(initDataParams.get('user')));
                const userId = user.id;
                socket.userId = userId; //  Рассмотрите более безопасный способ хранения
                console.log(`Пользователь ${userId} успешно аутентифицирован.`);
                socket.emit('auth-success', { userId: userId });
            } catch (error) { // Обрабатываем ошибки парсинга
                console.error('Authentication error (parsing):', error);
                socket.emit('auth-failed', { message: 'Authentication failed: invalid user data.' });
                socket.disconnect(true);
            }
        } else {
            console.log('Ошибка аутентификации.');
            socket.emit('auth-failed', { message: 'Authentication failed: invalid signature.' });
            socket.disconnect(true);
        }
    });

    // Присоединение к комнате (пока не используется, но может пригодиться для WebRTC)
    socket.on('join-room', (data) => {
        const { roomId, userId } = data;
        socket.join(roomId);
        console.log(`Пользователь ${userId} присоединился к комнате ${roomId}`);
        socket.to(roomId).emit('user-joined', { userId: userId, socketId: socket.id });
    });

    // Обмен данными для установки соединения WebRTC (пока не используется)
    socket.on('offer', (data) => {
        socket.to(data.roomId).emit('offer', data);
    });

    socket.on('answer', (data) => {
        socket.to(data.roomId).emit('answer', data);
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.roomId).emit('ice-candidate', data);
    });

    // Обработка жестов (заглушка, нужно будет реализовать сохранение в MongoDB)
    socket.on('gesture', (gestureData) => {
        console.log('Получен жест:', gestureData);

     // Пример сохранения жеста в MongoDB (нужно адаптировать под вашу структуру данных)
      async function saveGesture() {
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 1000; // ms

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const db = client.db("holograms");
            const gestures = db.collection("gestures");
            await gestures.insertOne(gestureData);
            console.log("Gesture saved to MongoDB");
            return; // Success! Exit the loop.
          } catch (err) {
            console.error(`Error saving gesture (attempt ${attempt}):`, err);

            if (attempt === MAX_RETRIES) {
              console.error("Max retries reached. Giving up.");
              socket.emit('gesture-save-error', { error: 'Failed to save gesture after multiple retries.' });
              return;
            }

            // Check if the error is likely to be temporary.  This is a simplified example,
            // and you might need to check for more specific error codes/messages.
            if (err.name === 'MongoNetworkError' || err.message.includes('timed out')) {
              console.log(`Temporary error. Retrying in ${RETRY_DELAY}ms...`);
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            } else {
              // Permanent error.  Don't retry.
              console.error("Permanent error.  Giving up.");
              socket.emit('gesture-save-error', { error: err.message });
              return;
            }
          }
        }
      }
      saveGesture();

    // Отправка жеста другим пользователям в той же комнате
    if (socket.rooms.size > 0) {
      socket.to(Array.from(socket.rooms)[0]).emit('gesture', gestureData);
    }
    else{
      socket.broadcast.emit('gesture', gestureData);
    }
});

    socket.on('disconnect', () => {
        console.log('Пользователь отключился:', socket.id);
    });
});

// Запуск сервера
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
