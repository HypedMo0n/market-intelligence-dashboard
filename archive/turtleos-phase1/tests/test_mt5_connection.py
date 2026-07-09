import pytest

from turtleos.data.mt5_connection import MT5ConnectionConfig, MT5ConnectionError


def test_mt5_env_requires_complete_login_tuple(monkeypatch):
    monkeypatch.setenv("MT5_LOGIN", "123456")
    monkeypatch.delenv("MT5_PASSWORD", raising=False)
    monkeypatch.setenv("MT5_SERVER", "Demo")

    with pytest.raises(MT5ConnectionError, match="must all be set"):
        MT5ConnectionConfig.from_env()


def test_mt5_env_reads_complete_login_tuple(monkeypatch):
    monkeypatch.setenv("MT5_LOGIN", "123456")
    monkeypatch.setenv("MT5_PASSWORD", "secret")
    monkeypatch.setenv("MT5_SERVER", "Demo")
    monkeypatch.setenv("MT5_TERMINAL_PATH", "C:/MT5/terminal64.exe")

    config = MT5ConnectionConfig.from_env()

    assert config.login == 123456
    assert config.password == "secret"
    assert config.server == "Demo"
    assert config.terminal_path == "C:/MT5/terminal64.exe"
