"""Shared fixtures for all tests. pytest loads this file by itself before running the tests.

A fixture is preparation that a test asks for by name, as a parameter:

    def test_cart_starts_empty(logged_in_page: Page):
        ...

pytest runs the fixture first and passes in what it returns. `page`, `context`, `browser`
and `base_url` are fixtures that come with pytest-playwright; the ones below are ours.
"""
import socket
import threading
from urllib.parse import urlparse

import pytest
from playwright.sync_api import Page, expect

from pages.login_page import LoginPage
from serve_app import make_server


@pytest.fixture(scope="session", autouse=True)
def bloomly_app(base_url):
    """Starts Bloomly (the app in ./app) before the first test and stops it after the last one.

    autouse=True: every test gets it without asking. scope="session": once per `pytest` run.
    If Bloomly is already running (you started `python serve_app.py` in another terminal),
    the tests simply use it. A base URL that isn't localhost is left alone.
    """
    url = urlparse(base_url or "")
    port = url.port or 80
    if url.hostname not in ("localhost", "127.0.0.1") or _something_answers_on(port):
        yield
        return
    server = make_server(port)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield
    server.shutdown()
    server.server_close()


def _something_answers_on(port: int) -> bool:
    try:
        socket.create_connection(("localhost", port), timeout=1).close()
        return True
    except OSError:
        return False


@pytest.fixture
def logged_in_page(page: Page) -> Page:
    """A page where Anna (anna@bloomly.app) is already logged in through the login form.

    Use it for every test whose precondition is "the user is logged in":

        def test_account_shows_the_users_city(logged_in_page: Page):
            logged_in_page.goto("/account")
            expect(logged_in_page.get_by_test_id("account-city")).to_have_text("Lisbon")

    If logging in fails, the test stops here with ERROR (the precondition failed),
    not with a misleading FAILED somewhere later.
    """
    login_page = LoginPage(page)
    login_page.open()
    login_page.log_in("anna@bloomly.app", "bloom123")
    expect(page.get_by_role("button", name="Log out")).to_be_visible()
    return page
