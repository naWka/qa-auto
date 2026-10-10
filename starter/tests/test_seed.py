from playwright.sync_api import Page, expect


# Seed test: the starting point for AI agents (planner, generator, healer — see specs/README.md).
# It shows them where the app lives, how a test opens it, and the style our tests follow.
# Ask the agent to start every exploration from here: "Run tests/test_seed.py, then open …".
def test_seed(page: Page):
    page.goto("/")
    expect(page.get_by_role("heading", name="Fresh flowers, delivered with love")).to_be_visible()
