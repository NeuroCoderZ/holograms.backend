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
            const user = JSON.parse(decodeURIComponent(initData.user));
            const userId = user.id;
            socket.userId = userId;
            console.log(`Пользователь ${userId} успешно аутентифицирован.`);
            socket.emit('auth-success', { userId: userId });
        } else {
            console.log('Ошибка аутентификации.');
            socket.emit('auth-failed');
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
        try {
          const db = client.db("holograms"); //  Имя вашей базы данных
          const gestures = db.collection("gestures"); //  Имя коллекции
          await gestures.insertOne(gestureData);
          console.log("Gesture saved to MongoDB");
        } catch (err) {
          console.error("Error saving gesture to MongoDB:", err);
           //  Отправьте сообщение об ошибке клиенту, если нужно
           socket.emit('gesture-save-error', { error: err.message });
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
