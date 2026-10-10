from playwright.sync_api import Page


class LoginPage:
    """Page object for /login: locators and actions in one place.

    Assertions stay in the tests, so every test shows what it checks.
    If the page changes (say, the button becomes "Sign in"), you fix it here once.
    """

    def __init__(self, page: Page):
        self.page = page
        self.email = page.get_by_label("Email")
        self.password = page.get_by_label("Password")
        self.log_in_button = page.get_by_role("button", name="Log in")
        self.error = page.get_by_role("alert")

    def open(self):
        self.page.goto("/login")

    def log_in(self, email: str, password: str):
        self.email.fill(email)
        self.password.fill(password)
        self.log_in_button.click()
