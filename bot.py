import asyncio
import logging
import os
import random
from typing import Optional

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import CommandStart, Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.utils.keyboard import InlineKeyboardBuilder
import aiohttp
from dotenv import load_dotenv

from storage import Storage

# --- CONFIG & INIT ---
load_dotenv()
BOT_TOKEN = os.getenv("BOT_TOKEN")
TMDB_API_KEY = os.getenv("TMDB_API_KEY")
ADMIN_ID = int(os.getenv("ADMIN_ID", 0))
DB_PATH = os.getenv("DB_PATH", "bot.sqlite")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp = Dispatcher()
router = Router()
dp.include_router(router)
storage = Storage(DB_PATH)

# --- TMDB API CLIENT ---
class TMDbClient:
    BASE_URL = "https://api.themoviedb.org/3"
    IMAGE_BASE = "https://image.tmdb.org/t/p/w500"

    def __init__(self, api_key: str):
        self.api_key = api_key

    async def _request(self, endpoint: str, params: dict = None) -> dict:
        if params is None:
            params = {}
        params['api_key'] = self.api_key
        params['language'] = 'ru-RU'
        
        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(f"{self.BASE_URL}{endpoint}", params=params, timeout=10) as resp:
                    if resp.status == 200:
                        return await resp.json()
                    logger.error(f"TMDb API Error: {resp.status}")
                    return {}
            except Exception as e:
                logger.error(f"TMDb Request Exception: {e}")
                return {}

    async def discover(self, **kwargs) -> list:
        data = await self._request("/discover/movie", kwargs)
        return data.get("results", [])

    async def get_movie(self, movie_id: int) -> dict:
        return await self._request(f"/movie/{movie_id}")

    async def search(self, query: str) -> list:
        data = await self._request("/search/movie", {"query": query})
        return data.get("results", [])

    async def get_similar(self, movie_id: int) -> list:
        data = await self._request(f"/movie/{movie_id}/similar")
        return data.get("results", [])

tmdb = TMDbClient(TMDB_API_KEY)

# --- STATES ---
class SearchState(StatesGroup):
    waiting_for_movie_name = State()

# --- KEYBOARDS ---
def main_menu_kb() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="🎬 Подобрать фильм", callback_data="mode_filter"))
    builder.row(
        InlineKeyboardButton(text="🔥 Анти-скролл (1 топ фильм)", callback_data="mode_antiscroll"),
        InlineKeyboardButton(text="⏱ На 90 минут", callback_data="mode_90mins")
    )
    builder.row(
        InlineKeyboardButton(text="🙈 Слепой выбор", callback_data="mode_blind"),
        InlineKeyboardButton(text="🎯 Похожее на...", callback_data="mode_similar")
    )
    builder.row(
        InlineKeyboardButton(text="👥 Киновечер", callback_data="mode_party"),
        InlineKeyboardButton(text="🧠 Не знаю что смотреть", callback_data="mode_idk")
    )
    builder.row(
        InlineKeyboardButton(text="⭐ Избранное", callback_data="my_watchlist"),
        InlineKeyboardButton(text="🎁 Пригласить друга", callback_data="invite_friend")
    )
    return builder.as_markup()

def movie_card_kb(movie_id: int, is_blind: bool = False) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    if is_blind:
        builder.row(InlineKeyboardButton(text="👀 Открыть название и постер", callback_data=f"reveal_{movie_id}"))
    else:
        builder.row(
            InlineKeyboardButton(text="👍", callback_data=f"action_like_{movie_id}"),
            InlineKeyboardButton(text="👎", callback_data=f"action_dislike_{movie_id}"),
            InlineKeyboardButton(text="⭐ В избранное", callback_data=f"action_watchlist_{movie_id}")
        )
        builder.row(
            InlineKeyboardButton(text="✅ Уже смотрел", callback_data=f"action_seen_{movie_id}"),
            InlineKeyboardButton(text="⏭ Еще вариант", callback_data="next_random")
        )
        # Заглушка для трейлера (в реале нужно делать отдельный запрос к /videos)
        builder.row(InlineKeyboardButton(text="▶ Искать трейлер", url=f"https://www.youtube.com/results?search_query=Трейлер+фильма+{movie_id}"))
    builder.row(InlineKeyboardButton(text="🔙 В меню", callback_data="back_to_menu"))
    return builder.as_markup()

# --- FORMATTERS ---
def format_movie_card(movie: dict, is_blind: bool = False) -> tuple[str, str]:
    if not movie:
        return "Фильм не найден.", ""
    
    title = movie.get('title', 'Без названия')
    original_title = movie.get('original_title', '')
    year = movie.get('release_date', '')[:4]
    rating = round(movie.get('vote_average', 0), 1)
    desc = movie.get('overview', 'Описание отсутствует.')[:500] + "..."
    poster_path = movie.get('poster_path')
    poster_url = f"{TMDbClient.IMAGE_BASE}{poster_path}" if poster_path else "https://via.placeholder.com/500x750?text=No+Poster"

    if is_blind:
        text = (
            f"🙈 <b>Слепой выбор</b>\n\n"
            f"Рейтинг: ⭐ {rating}\n"
            f"Год: {year}\n\n"
            f"<i>{desc}</i>\n\n"
            f"Нажми кнопку ниже, чтобы узнать, что это за фильм!"
        )
        return text, "https://via.placeholder.com/500x750/000000/FFFFFF?text=Secret+Movie"

    text = (
        f"🎬 <b>{title}</b> ({year})\n"
        f"<i>{original_title}</i>\n\n"
        f"⭐ Рейтинг: <b>{rating}</b>/10\n\n"
        f"📝 <b>О сюжете:</b>\n{desc}"
    )
    return text, poster_url

# --- HANDLERS ---
@router.message(CommandStart())
async def cmd_start(message: Message):
    args = message.text.split()
    ref_by = int(args[1]) if len(args) > 1 and args[1].isdigit() else None
    await storage.add_user(message.from_user.id, message.from_user.username, ref_by)
    
    text = (
        "🍿 <b>Привет! Я твой умный кино-ассистент.</b>\n\n"
        "Забудь про долгие поиски. Я помогу найти идеальный фильм на вечер за пару кликов.\n"
        "Выбирай режим ниже 👇"
    )
    await message.answer(text, reply_markup=main_menu_kb())

@router.callback_query(F.data == "back_to_menu")
async def cb_back_to_menu(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.message.edit_text("🍿 <b>Главное меню</b>\nВыбирай режим:", reply_markup=main_menu_kb())

@router.callback_query(F.data.startswith("mode_"))
async def cb_modes(callback: CallbackQuery, state: FSMContext):
    mode = callback.data.split("_")[1]
    await callback.answer("Ищу магию кино... 🪄")
    
    # Получаем историю пользователя, чтобы не предлагать то, что он уже видел/дизлайкнул
    seen = await storage.get_user_movies(callback.from_user.id, "seen")
    disliked = await storage.get_user_movies(callback.from_user.id, "dislike")
    exclude_ids = set(seen + disliked)

    movies = []
    is_blind = False

    if mode == "antiscroll":
        # Топ рейтинг, популярное
        movies = await tmdb.discover(sort_by="popularity.desc", vote_average_gte=7.5, vote_count_gte=1000)
    elif mode == "90mins":
        # До 90 минут
        movies = await tmdb.discover(with_runtime_lte=90, sort_by="popularity.desc", vote_average_gte=6.5)
    elif mode == "blind":
        movies = await tmdb.discover(sort_by="popularity.desc", vote_average_gte=8.0)
        is_blind = True
    elif mode == "party":
        # Комедии (35) или Экшен (28)
        movies = await tmdb.discover(with_genres="35,28", sort_by="popularity.desc")
    elif mode == "similar":
        await callback.message.answer("Напиши название твоего любимого фильма, и я найду похожие:")
        await state.set_state(SearchState.waiting_for_movie_name)
        return
    elif mode == "idk":
        # Сюрприз из случайной страницы хороших фильмов
        page = random.randint(1, 10)
        movies = await tmdb.discover(sort_by="popularity.desc", vote_average_gte=7.0, page=page)
    else:
        await callback.message.answer("Этот режим в разработке 🚀", reply_markup=main_menu_kb())
        return

    # Фильтрация
    valid_movies = [m for m in movies if m.get("id") not in exclude_ids]
    
    if not valid_movies:
        await callback.message.answer("Кажется, ты пересмотрел всё в этой категории! Попробуй другой режим.", reply_markup=main_menu_kb())
        return

    movie = random.choice(valid_movies)
    text, poster = format_movie_card(movie, is_blind=is_blind)
    
    # Удаляем старое сообщение и шлем новое с фото
    await callback.message.delete()
    await callback.message.answer_photo(
        photo=poster,
        caption=text,
        reply_markup=movie_card_kb(movie['id'], is_blind=is_blind)
    )

@router.message(SearchState.waiting_for_movie_name)
async def process_similar_search(message: Message, state: FSMContext):
    query = message.text
    search_results = await tmdb.search(query)
    
    if not search_results:
        await message.answer("Не нашел такого фильма. Попробуй другое название.", reply_markup=main_menu_kb())
        await state.clear()
        return

    first_movie_id = search_results[0]['id']
    similar_movies = await tmdb.get_similar(first_movie_id)
    
    if not similar_movies:
        await message.answer("К этому фильму сложно подобрать похожее 😔", reply_markup=main_menu_kb())
        await state.clear()
        return

    movie = random.choice(similar_movies[:10]) # Берем из топ-10 похожих
    text, poster = format_movie_card(movie)
    
    await message.answer_photo(photo=poster, caption=text, reply_markup=movie_card_kb(movie['id']))
    await state.clear()

@router.callback_query(F.data.startswith("reveal_"))
async def cb_reveal(callback: CallbackQuery):
    movie_id = int(callback.data.split("_")[1])
    movie = await tmdb.get_movie(movie_id)
    text, poster = format_movie_card(movie, is_blind=False)
    
    await callback.message.delete()
    await callback.message.answer_photo(
        photo=poster,
        caption=text,
        reply_markup=movie_card_kb(movie_id, is_blind=False)
    )

@router.callback_query(F.data.startswith("action_"))
async def cb_movie_action(callback: CallbackQuery):
    _, action, movie_id = callback.data.split("_")
    user_id = callback.from_user.id
    
    await storage.add_movie_action(user_id, int(movie_id), action)
    
    action_texts = {
        "like": "✅ Запомнил! Буду предлагать больше такого.",
        "dislike": "🗑 Понял, больше такое не предложу.",
        "watchlist": "⭐ Добавлено в избранное!",
        "seen": "👀 Отметил как просмотренное."
    }
    
    await callback.answer(action_texts.get(action, "Сохранено!"))

@router.callback_query(F.data == "next_random")
async def cb_next_random(callback: CallbackQuery):
    # Простой переход к анти-скроллу для кнопки "Еще вариант"
    await cb_modes(callback, FSMContext(storage=dp.storage, key=callback.message.chat.id))

@router.callback_query(F.data == "invite_friend")
async def cb_invite(callback: CallbackQuery):
    bot_info = await bot.get_me()
    ref_link = f"https://t.me/{bot_info.username}?start={callback.from_user.id}"
    text = (
        "🎁 <b>Пригласи друга и получи бонусы!</b>\n\n"
        "<i>(В будущем здесь будет Premium-подписка за приглашения)</i>\n\n"
        f"Твоя ссылка:\n{ref_link}"
    )
    await callback.message.answer(text, reply_markup=main_menu_kb())
    await callback.answer()

@router.message(Command("admin"))
async def cmd_admin(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
    stats = await storage.get_stats()
    text = (
        "👑 <b>Админ-панель</b>\n\n"
        f"👥 Пользователей: {stats['users']}\n"
        f"🎬 Действий с фильмами: {stats['actions']}\n"
    )
    await message.answer(text)

# --- MAIN LOOP ---
async def main():
    await storage.init_db()
    logger.info("Starting bot...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
