import pytest
from playwright.sync_api import Page, expect

from pages.login_page import LoginPage


# TC-001: Registered user can log in
@pytest.mark.smoke
def test_registered_user_can_log_in(page: Page):
    login_page = LoginPage(page)
    login_page.open()
    login_page.log_in("anna@bloomly.app", "bloom123")
    expect(page).to_have_url("http://localhost:3000/account")
    expect(page.get_by_role("heading", name="Welcome back, Anna!")).to_be_visible()


# TC-102: Wrong password shows an error
def test_wrong_password_shows_an_error(page: Page):
    login_page = LoginPage(page)
    login_page.open()
    login_page.log_in("anna@bloomly.app", "wrong-pass")
    expect(login_page.error).to_have_text("Invalid email or password.")
    expect(page).to_have_url("http://localhost:3000/login")


# TC-005: Logged-in user sees their name in the header
# Precondition "Anna is logged in" comes from the logged_in_page fixture in conftest.py
def test_logged_in_user_sees_their_name_in_the_header(logged_in_page: Page):
    menu = logged_in_page.get_by_role("navigation", name="Main")
    expect(menu.get_by_test_id("user-name")).to_have_text("Anna")
    expect(menu.get_by_role("button", name="Log out")).to_be_visible()
    expect(menu.get_by_role("link", name="Log in")).not_to_be_visible()
