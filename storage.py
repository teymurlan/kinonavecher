import aiosqlite
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

class Storage:
    def __init__(self, db_path: str = "bot.sqlite"):
        self.db_path = db_path

    async def init_db(self):
        async with aiosqlite.connect(self.db_path) as db:
            # Таблица пользователей
            await db.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    user_id INTEGER PRIMARY KEY,
                    username TEXT,
                    ref_by INTEGER,
                    is_premium BOOLEAN DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Таблица истории взаимодействий с фильмами
            # actions: like, dislike, seen, watchlist
            await db.execute("""
                CREATE TABLE IF NOT EXISTS movie_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    movie_id INTEGER,
                    action TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, movie_id, action)
                )
            """)
            await db.commit()
            logger.info("Database initialized.")

    async def add_user(self, user_id: int, username: str, ref_by: int = None):
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT OR IGNORE INTO users (user_id, username, ref_by) VALUES (?, ?, ?)",
                (user_id, username, ref_by)
            )
            await db.commit()

    async def get_user(self, user_id: int):
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)) as cursor:
                return await cursor.fetchone()

    async def add_movie_action(self, user_id: int, movie_id: int, action: str):
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT OR REPLACE INTO movie_history (user_id, movie_id, action) VALUES (?, ?, ?)",
                (user_id, movie_id, action)
            )
            await db.commit()

    async def get_user_movies(self, user_id: int, action: str = None):
        async with aiosqlite.connect(self.db_path) as db:
            query = "SELECT movie_id FROM movie_history WHERE user_id = ?"
            params = [user_id]
            if action:
                query += " AND action = ?"
                params.append(action)
            async with db.execute(query, params) as cursor:
                rows = await cursor.fetchall()
                return [row[0] for row in rows]

    async def get_stats(self):
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute("SELECT COUNT(*) FROM users") as cursor:
                users_count = (await cursor.fetchone())[0]
            async with db.execute("SELECT COUNT(*) FROM movie_history") as cursor:
                actions_count = (await cursor.fetchone())[0]
            return {"users": users_count, "actions": actions_count}
