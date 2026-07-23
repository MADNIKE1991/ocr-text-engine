const express = require('express');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const Groq = require('groq-sdk');

const app = express();
const port = 3644;

// Инициализация Groq (ВСТАВЬ СВОЙ КЛЮЧ СЮДА)
const groq = new Groq({
    apiKey: 'СЮДА_ВСТАВЬ_СВОЙ_КЛЮЧ_ОТ_GROQ'

    // Подсказка: Если решишь пустить Node.js через прокси, раскомментируй этот блок
    // и установи пакет: npm install https-proxy-agent
    // const { HttpsProxyAgent } = require('https-proxy-agent');
    // httpAgent: new HttpsProxyAgent('http://логин:пароль@ip:порт')
});

const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));

app.post('/upload', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Изображение не загружено.' });
    }

    try {
        // 1. Сырое распознавание Tesseract (Базовый слой)
        console.log(`[System] Файл загружен, запускаем Tesseract...`);
        const { data: { text: rawText } } = await Tesseract.recognize(
            req.file.path,
            'rus+eng',
            {
                // Выводим только прогресс распознавания, чтобы не спамить в консоль
                logger: m => {
                    if (m.status === 'recognizing text') {
                        console.log(`[Tesseract] Распознавание: ${Math.round(m.progress * 100)}%`);
                    }
                },
                tessedit_pageseg_mode: 6
            }
        );

        // Сразу удаляем временную картинку, чтобы не засорять диск
        fs.unlinkSync(req.file.path);

        if (!rawText || rawText.trim() === '') {
            return res.json({ text: 'Текст не найден или изображение нечитаемо.' });
        }

        let finalText = rawText; // По умолчанию готовимся отдать сырой текст

        // 2. Изолированный блок AI-коррекции
        try {
            console.log('[Groq] Отправка текста на ИИ-коррекцию...');
            const chatCompletion = await groq.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "Ты строгий редактор OCR. Тебе дают текст, распознанный с картинки. В нем могут быть опечатки, мусорные символы и слипшиеся слова. Твоя задача — исправить текст, опираясь на логику и русский язык. ВЕРНИ ТОЛЬКО ИСПРАВЛЕННЫЙ ТЕКСТ. Никаких вступлений, приветствий, кавычек или комментариев."
                    },
                    { role: "user", content: rawText }
                ],
                model: "llama3-70b-8192",
                temperature: 0.1, // Строгая логика, минимум галлюцинаций
                max_tokens: 2000
            });

            finalText = chatCompletion.choices[0]?.message?.content || rawText;
            console.log('[Groq] Текст успешно очищен!');

        } catch (aiError) {
            // Если Groq упал (403, таймаут и т.д.), мы не валим сервер
            console.error(`[Groq] Ошибка API: ${aiError.status || aiError.message}. Отдаем сырой текст Tesseract.`);
        }

        // 3. Отправляем финальный результат на клиент
        res.json({ text: finalText.trim() });

    } catch (error) {
        console.error('[System] Критическая ошибка:', error);
        res.status(500).json({ error: 'Сбой при обработке изображения сервером.' });
    }
});

app.listen(port, () => {
    console.log(`Сервер запущен: http://localhost:${port}`);
    console.log(`Архитектура: Tesseract (Base) + Groq Llama 3 (AI Fail-safe)`);
});