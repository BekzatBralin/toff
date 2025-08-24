const { VK, Keyboard } = require("vk-io");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const vk = new VK({ token: process.env.VK_TOKEN });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const DATA_FILE = path.join(__dirname, "botData.json");
const IMAGE_PATH_CHISLA = path.join(__dirname, "img", "chisla.jpg");
const IMAGE_PATH_RZ = path.join(__dirname, "img", "rz.jpg");
const IMAGE_PATH_AN = path.join(__dirname, "img", "an.jpg");

let botData = loadData();
const myId = parseInt(process.env.VK_GROUP_ID) || null;

function loadData() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!data.admins) data.admins = [609824089, 8669264];
    return data;
  } catch (e) {
    return {
      admins: [609824089, 8669264],
      currentGame: null,
      giveaway: null,
      participants: [],
      currentGames: {},
      quiz: null,
      roulette: null
    };
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(botData, null, 2), "utf8");
}

function parseAmount(input) {
  input = input.toLowerCase().replace(/\s/g, "");
  let num = parseFloat(input.replace(/[^0-9.,]/g, "").replace(",", ".")) || 0;
  if (input.includes("ккк")) return num * 1_000_000_000;
  if (input.includes("кк")) return num * 1_000_000;
  if (input.includes("к")) return num * 1_000;
  return num;
}

function formatNumber(num) {
  if (typeof num === "string") num = parseAmount(num);
  return num.toLocaleString("en-US");
}

function formatPrize(input) {
  return `$${formatNumber(input)}`;
}

function shuffleWord(word) {
  let letters = word.split("");
  let shuffled;
  do {
    shuffled = letters.sort(() => Math.random() - 0.5).join("");
  } while (shuffled === word);
  return shuffled;
}

async function getRandomWord() {
  try {
    const prompt = "Придумай одно русское слово длиной от 5 до 10 букв для игры в анаграммы. Слово должно быть существительным в именительном падеже, единственном числе. В ответе только одно слово, без знаков препинания, дополнительных слов или объяснений.";
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = await response.text();
    const word = text.trim().toLowerCase();

    if (word.length >= 5 && word.length <= 10 && /^[а-яё]+$/.test(word)) {
      return word;
    }
  } catch (error) {
    console.error("Failed to fetch words from Gemini API:", error);
  }
  return "программа";
}

vk.updates.on("message_new", async (ctx) => {
  // Добавляем проверку здесь
  if (ctx.peerType !== 'chat' && ctx.peerType !== 'group') {
    return;
  }

  const text = ctx.text?.trim();
  const lowerText = text?.toLowerCase();
  const senderId = ctx.senderId;
  const peerId = ctx.peerId;

  if (!text) return;

  if (botData.admins.includes(senderId)) {
    if (lowerText.startsWith("!админка")) {
      const args = text.split(" ");
      if (args.length < 2) return ctx.send("⚠️ Формат: !админка <id_пользователя>");
      const targetId = parseInt(args[1]);
      if (isNaN(targetId)) return ctx.send("❌ Неверный ID пользователя.");
      const is_admin = botData.admins.includes(targetId);
      if (is_admin) {
        botData.admins = botData.admins.filter(id => id !== targetId);
        saveData();
        return ctx.send(`✅ [id${targetId}|Пользователь] успешно снят с должности администратора.`);
      } else {
        botData.admins.push(targetId);
        saveData();
        return ctx.send(`✅ [id${targetId}|Пользователь] успешно назначен администратором.`);
      }
    }

    if (lowerText === "!скрыть") {
        await ctx.send({
            message: "Кнопка скрыта.",
            keyboard: Keyboard.builder().inline(false).oneTime()
        });
        return;
    }

    if (lowerText.startsWith("!числа")) {
      if (botData.currentGame) return ctx.send("⛔ Игра уже идёт.");
      const args = text.split(" ");
      if (args.length < 2) return ctx.send("⚠️ Пример: !числа 1кк");
      const amount = parseAmount(args[1]);
      if (!amount || isNaN(amount)) return ctx.send("❌ Неверный формат суммы.");
      const secret = Math.floor(Math.random() * 37);
      const prizeQuarter = amount / 5;
      botData.currentGame = {
        secret,
        amount,
        answers: {},
        chatId: peerId,
        fullPrize: formatPrize(amount),
        prizeQuarter
      };
      saveData();
      const photo = await vk.upload.messagePhoto({ source: { value: fs.createReadStream(IMAGE_PATH_CHISLA) } });
      await ctx.send({
        message: `@all 🎲 Угадай число от 0 до 36 и получи ${botData.currentGame.fullPrize}!\n\n` +
                 `У тебя только одна попытка!☝️\n\n` +
                 `Итоги через 2 минуты⏰ Удачи! 🍀`,
        attachment: photo.toString()
      });
      setTimeout(() => finishGame(ctx), 2 * 60 * 1000);
      return;
    }

    if (lowerText.startsWith("!розыгрыш")) {
      const args = text.split(" ");
      if (args.length < 3) return ctx.send("⚠️ Формат: !розыгрыш <сумма> <победителей>");
      const total = parseAmount(args[1]);
      const winners = parseInt(args[2]);
      if (isNaN(winners) || winners <= 0) return ctx.send("❌ Неверное число победителей.");
      botData.giveaway = {
        total: formatPrize(total),
        winnersCount: winners,
        each: formatPrize(total / winners)
      };
      botData.participants = [];
      saveData();
      const photo = await vk.upload.messagePhoto({ source: { value: fs.createReadStream(IMAGE_PATH_RZ) } });
      await ctx.send({
        message: `🔥 Розыгрыш на ${botData.giveaway.total}!🔥\n💰 ${winners} счастливчика получат по ${botData.giveaway.each}!💰\nХочешь стать одним из них? 🤑 \nТогда нажимай "Участвовать"! 🤩`,
        attachment: photo.toString(),
        keyboard: Keyboard.builder().textButton({ label: 'Участвовать', payload: { cmd: 'join' }, color: 'positive' })
      });
      await ctx.send(`🔥 @all ВНИМАНИЕ!  🔥\n💥  Сейчас проводится розыгрыш на ${botData.giveaway.total}! 🤯`);
      return;
    }

    if (lowerText.startsWith("!ан")) {
      const match = text.match(/!ан\s+(.+)/);
      if (!match) return ctx.send("⚠️ Формат: !ан <приз>");
      const rawPrize = match[1].trim();
      const word = await getRandomWord();
      const prize = formatPrize(rawPrize);
      const anagram = shuffleWord(word);
      botData.currentGames[peerId] = { word, prize };
      saveData();
      const photo = await vk.upload.messagePhoto({ source: { value: fs.createReadStream(IMAGE_PATH_AN) } });
      return ctx.send({
        message: `@online 🔥Ну что, давайте попробуем разгадать эту анаграмму!🤔Анаграмма на ${prize}!\n\nСЛОВО — ${anagram}\nПЕРВАЯ БУКВА — ${word[0]}\n\n😜  Ну-ка, подумайте, что это может быть!`,
        attachment: photo.toString()
      });
    }

    if (lowerText === "!итоги") {
      if (!botData.giveaway) return ctx.send("❗ Розыгрыш не запущен.");
      if (botData.participants.length < botData.giveaway.winnersCount) {
        return ctx.send(`❌ Недостаточно участников: ${botData.participants.length} из ${botData.giveaway.winnersCount}.`);
      }
      await ctx.send({
        message: "📢 Подвожу итоги!",
        keyboard: Keyboard.builder().inline(false).oneTime()
      });
      const shuffled = botData.participants.sort(() => 0.5 - Math.random());
      const winners = shuffled.slice(0, botData.giveaway.winnersCount);
      for (const id of winners) {
        const [user] = await vk.api.users.get({ user_ids: id });
        await ctx.send(`🎉🎉🎉 ПОЗДРАВЛЯЕМ! 🎉🎉🎉 \n[id${id}|${user.first_name} ${user.last_name}] - ВЫ ВЫИГРАЛИ ${botData.giveaway.each}🤑🤑🤑`);
      }
      botData.giveaway = null;
      botData.participants = [];
      saveData();
      await ctx.send({ message: "", keyboard: Keyboard.builder().inline(false).oneTime() });
      return;
    }

    if (lowerText === "!уча") {
      if (!botData.giveaway) return ctx.send("❗ Розыгрыш неактивен.");
      if (botData.participants.length === 0) return ctx.send("⛔ Участников пока нет.");
      let list = "✨ Список участников ✨\n\n";
      for (const id of botData.participants) {
        const [user] = await vk.api.users.get({ user_ids: id });
        list += `[id${id}|${user.first_name} ${user.last_name}]\n`;
      }
      return ctx.send(list);
    }

    if (lowerText === "!стоп") {
      if (botData.currentGame) {
        botData.currentGame = null;
        saveData();
        return ctx.send("✅ Игра 'Угадай число' принудительно остановлена.");
      }
      if (botData.giveaway) {
        botData.giveaway = null;
        botData.participants = [];
        saveData();
        await ctx.send({ message: "✅ Розыгрыш принудительно остановлен.", keyboard: Keyboard.builder().inline(false).oneTime() });
        return;
      }
      if (botData.roulette) {
        botData.roulette = null;
        saveData();
        return ctx.send("✅ Рулетка принудительно остановлена.");
      }
      if (botData.quiz) {
        botData.quiz = null;
        saveData();
        return ctx.send("✅ Викторина принудительно остановлена.");
      }
      return ctx.send("❗ Нет активных игр для остановки.");
    }
  }

  const myIdStr = myId?.toString();
  const lowerTextContainsMention = myIdStr && lowerText.includes(`[club${myIdStr}|`) && lowerText.includes("участвовать");

  if (botData.giveaway && (lowerText === "участвовать" || (ctx.payload && ctx.payload.cmd === "join") || lowerTextContainsMention)) {
      if (botData.participants.includes(senderId)) return ctx.send(`❗ Ты уже участвуешь.`);
      botData.participants.push(senderId);
      saveData();
      const [user] = await vk.api.users.get({ user_ids: senderId });
      try {
        if (ctx.peerId > 2000000000) {
          await vk.api.messages.delete({
            cmids: [ctx.conversationMessageId],
            peer_id: ctx.peerId,
            delete_for_all: true
          });
        }
      } catch (err) {
        console.error("❌ Не удалось удалить сообщение пользователя:", err);
      }
      return ctx.send(`🎉 [id${senderId}|${user.first_name} ${user.last_name}], ваше участие зарегистрировано!`);
  }

  if (botData.currentGame && peerId === botData.currentGame.chatId) {
    const number = parseInt(lowerText);
    if (!isNaN(number) && number >= 0 && number <= 36) {
      if (botData.currentGame.answers[senderId] !== undefined) {
        const [user] = await vk.api.users.get({ user_ids: senderId });
        return ctx.send(`❗ [id${senderId}|${user.first_name} ${user.last_name}], ты уже выбрал число!`);
      }
      const taken = Object.entries(botData.currentGame.answers).find(([_, n]) => n === number);
      if (taken) {
        const [takenId] = taken;
        const [user] = await vk.api.users.get({ user_ids: takenId });
        return ctx.send(`⚠️ Число ${number} уже выбрано [id${takenId}|${user.first_name} ${user.last_name}].`);
      }
      botData.currentGame.answers[senderId] = number;
      saveData();
      const [user] = await vk.api.users.get({ user_ids: senderId });
      return ctx.send(`✅ [id${senderId}|${user.first_name} ${user.last_name}], твое число ${number} принято! Удачи 🍀`);
    }
  }

  if (botData.currentGames[peerId] && lowerText === botData.currentGames[peerId].word) {
    const user = await vk.api.users.get({ user_ids: senderId });
    await ctx.send(`Поздравляю, [id${senderId}|${user[0].first_name} ${user[0].last_name}]! 🎉 Ты настоящий мастер анаграмм!  🧠\nСлово угадал, молодец! 👍`);
    delete botData.currentGames[peerId];
    saveData();
  }

  if (botData.quiz && lowerText === botData.quiz.answer) {
    const user = await vk.api.users.get({ user_ids: senderId });
    await ctx.send(`🎉🎉🎉 Поздравляю, [id${senderId}|${user[0].first_name} ${user[0].last_name}]! Ты первым ответил правильно и выиграл ${botData.quiz.prize}!🤑`);
    botData.quiz = null;
    saveData();
  }

  if (botData.roulette) {
    const bet = parseInt(lowerText);
    if (!isNaN(bet) && bet >= 0 && bet <= 36) {
      if (botData.roulette.bets[senderId]) {
        return ctx.send(`❗ Ты уже сделал ставку.`);
      }
      botData.roulette.bets[senderId] = bet;
      saveData();
      const user = await vk.api.users.get({ user_ids: senderId });
      return ctx.send(`✅ [id${senderId}|${user[0].first_name} ${user[0].last_name}], ваша ставка на число **${bet}** принята.`);
    }
  }
});

async function finishGame(ctx) {
  const game = botData.currentGame;
  if (!game) return;
  botData.currentGame = null;
  saveData();

  const secret = game.secret;
  const answers = game.answers;
  const winners = Object.entries(answers).filter(([_, num]) => num == secret);

  if (winners.length > 0) {
    for (const [id] of winners) {
      const [user] = await vk.api.users.get({ user_ids: id });
      await ctx.send(`🎉 [id${id}|${user.first_name} ${user.last_name}] угадал число ${secret} и получает ${game.fullPrize}!`);
    }
  } else {
    let closest = [];
    let minDiff = 100;
    for (const [id, num] of Object.entries(answers)) {
      const diff = Math.abs(num - secret);
      if (diff < minDiff) {
        minDiff = diff;
        closest = [id];
      } else if (diff === minDiff) {
        closest.push(id);
      }
    }
    if (closest.length > 0) {
      let msg = `Никто не угадал! 🤫\nЧисло было...${secret}\n\nБлижайшие к числу были:\n`;
      for (const id of closest) {
        const [user] = await vk.api.users.get({ user_ids: id });
        msg += ` - [id${id}|${user.first_name} ${user.last_name}]\n`;
      }
      msg += `Они получают ${formatPrize(game.prizeQuarter)}`;
      await ctx.send(msg);
    } else {
      await ctx.send(`😕 Никто не участвовал или слишком далеко от ${secret}.`);
    }
  }
}

async function finishRoulette(ctx) {
  const game = botData.roulette;
  if (!game) return;
  botData.roulette = null;
  saveData();

  const winningNumber = Math.floor(Math.random() * 37);
  const winners = Object.entries(game.bets).filter(([_, num]) => num == winningNumber);

  await ctx.send(`📢 Рулетка остановилась! Выигрышное число: **${winningNumber}**!`);

  if (winners.length > 0) {
    for (const [id] of winners) {
      const [user] = await vk.api.users.get({ user_ids: id });
      await ctx.send(`🎉 [id${id}|${user.first_name} ${user.last_name}] победил в рулетке и получает ${game.prize}!`);
    }
  } else {
    await ctx.send("😕 Никто не угадал выигрышное число.");
  }
}

vk.updates.start().then(() => {
    if (myId) {
        console.log(`Бот запущен! ID группы: ${myId}`);
    } else {
        console.log(`Бот запущен, но ID группы не найден в .env. Убедитесь, что он там есть.`);
    }
}).catch(console.error);