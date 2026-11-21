import unittest

from config import Config, _database_pool_options


class DatabasePoolConfigTests(unittest.TestCase):
    def test_default_pool_stays_below_session_pooler_limit(self):
        options = _database_pool_options({})

        self.assertEqual(options, {
            "pool_size": 3,
            "max_overflow": 0,
            "pool_timeout": 30,
        })
        self.assertEqual(
            Config.SQLALCHEMY_ENGINE_OPTIONS["pool_size"],
            options["pool_size"],
        )

    def test_pool_limits_are_configurable_and_nonnegative(self):
        options = _database_pool_options({
            "DATABASE_POOL_SIZE": "4",
            "DATABASE_MAX_OVERFLOW": "2",
            "DATABASE_POOL_TIMEOUT": "45",
        })

        self.assertEqual(options, {
            "pool_size": 4,
            "max_overflow": 2,
            "pool_timeout": 45,
        })

        clamped = _database_pool_options({
            "DATABASE_POOL_SIZE": "0",
            "DATABASE_MAX_OVERFLOW": "-1",
            "DATABASE_POOL_TIMEOUT": "0",
        })
        self.assertEqual(clamped, {
            "pool_size": 1,
            "max_overflow": 0,
            "pool_timeout": 1,
        })


if __name__ == "__main__":
    unittest.main()
