from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any


class MT5ConnectionError(RuntimeError):
    """Raised when MT5 historical-data connectivity is unavailable."""


@dataclass(frozen=True)
class MT5ConnectionConfig:
    login: int | None = None
    password: str | None = None
    server: str | None = None
    terminal_path: str | None = None

    @classmethod
    def from_env(cls) -> "MT5ConnectionConfig":
        _load_dotenv_if_available()
        login_raw = os.getenv("MT5_LOGIN")
        password = os.getenv("MT5_PASSWORD")
        server = os.getenv("MT5_SERVER")
        terminal_path = os.getenv("MT5_TERMINAL_PATH")

        login = int(login_raw) if login_raw else None
        supplied = [login is not None, bool(password), bool(server)]
        if any(supplied) and not all(supplied):
            raise MT5ConnectionError(
                "MT5_LOGIN, MT5_PASSWORD, and MT5_SERVER must all be set when using explicit MT5 login."
            )

        return cls(login=login, password=password, server=server, terminal_path=terminal_path)


class MT5Connection:
    """Authenticated MT5 connection for Phase 1 historical data only.

    Manual review required before future phases: this module intentionally does
    not expose order placement or trade execution methods.
    """

    def __init__(self, config: MT5ConnectionConfig | None = None) -> None:
        self.config = config or MT5ConnectionConfig.from_env()
        self.mt5: Any | None = None
        self.account_info: Any | None = None
        self.terminal_info: Any | None = None

    def connect(self) -> Any:
        try:
            import MetaTrader5 as mt5  # type: ignore
        except ImportError as exc:
            raise MT5ConnectionError(
                "MetaTrader5 package is not installed. Install it on the Windows MT5 machine "
                "or use CSV loading for local development."
            ) from exc

        kwargs = {"path": self.config.terminal_path} if self.config.terminal_path else {}
        if not mt5.initialize(**kwargs):
            raise MT5ConnectionError(f"MT5 initialize failed: {mt5.last_error()}")

        if self.config.login is not None:
            if not mt5.login(self.config.login, password=self.config.password, server=self.config.server):
                last_error = mt5.last_error()
                mt5.shutdown()
                raise MT5ConnectionError(f"MT5 login failed: {last_error}")

        terminal_info = mt5.terminal_info()
        if terminal_info is None:
            last_error = mt5.last_error()
            mt5.shutdown()
            raise MT5ConnectionError(f"MT5 terminal_info() returned None after connection: {last_error}")

        account_info = mt5.account_info()
        if account_info is None:
            last_error = mt5.last_error()
            mt5.shutdown()
            raise MT5ConnectionError(f"MT5 account_info() returned None after connection: {last_error}")

        self.mt5 = mt5
        self.account_info = account_info
        self.terminal_info = terminal_info
        return mt5

    def disconnect(self) -> None:
        if self.mt5 is not None:
            self.mt5.shutdown()
            self.mt5 = None
            self.account_info = None
            self.terminal_info = None

    def __enter__(self) -> "MT5Connection":
        self.connect()
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.disconnect()


def _load_dotenv_if_available() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv()
