from __future__ import annotations

import pytest

from conftest import fixture_text
from kef_scraper.fetch import OFFERS_PATH, SITEMAP_PATH, USER_AGENT
from kef_scraper.robots import is_allowed, parse_rules


def _allowed(robots: str, path: str, agent: str = USER_AGENT) -> bool:
    return is_allowed(parse_rules(robots, agent), path)


class TestKauflandRobots:
    """Kaufland's robots.txt as of 2026-11-16."""

    @pytest.mark.parametrize(
        "path",
        [
            SITEMAP_PATH,
            OFFERS_PATH,
            "/service/filiale/kassel-wesertor-4453.html",
            "/service/filiale/halle-saale--1393.html",
            "/etc.clientlibs/kaufland/clientlibs/site.js",
        ],
    )
    def test_allowed(self, path: str) -> None:
        assert _allowed(fixture_text("robots.txt"), path)

    @pytest.mark.parametrize(
        "path",
        [
            "/.klstorefinder.json",  # the store list the scraper used to read
            "/.klstorebygeo.klstorefinder.json",
            "/service/filiale.storefinder_DE4453.html",
            "/etc.clientlibs/other/site.js",
            "/angebote/naechste-woche/detail.html",
        ],
    )
    def test_disallowed(self, path: str) -> None:
        assert not _allowed(fixture_text("robots.txt"), path)


class TestMatching:
    def test_no_rules_allow_everything(self) -> None:
        assert _allowed("", "/anything")
        assert _allowed("User-agent: *\nDisallow:\n", "/anything")

    def test_prefix(self) -> None:
        robots = "User-agent: *\nDisallow: /private"
        assert not _allowed(robots, "/private/page.html")
        assert not _allowed(robots, "/private-notes")
        assert _allowed(robots, "/public/private")

    def test_wildcard_and_end_anchor(self) -> None:
        robots = "User-agent: *\nDisallow: /*.json$\nDisallow: /a/*/c"
        assert not _allowed(robots, "/data/stores.json")
        assert _allowed(robots, "/data/stores.json?x=1")
        assert _allowed(robots, "/data/stores.jsonl")
        assert not _allowed(robots, "/a/b/c/d")
        assert _allowed(robots, "/a/c")

    def test_pattern_characters_are_literal(self) -> None:
        robots = "User-agent: *\nDisallow: /a.b+(c)"
        assert not _allowed(robots, "/a.b+(c)")
        assert _allowed(robots, "/aXb+(c)")

    def test_longest_match_wins_and_allow_wins_a_tie(self) -> None:
        robots = "User-agent: *\nDisallow: /shop/\nAllow: /shop/offers/\nDisallow: /x\nAllow: /x"
        assert not _allowed(robots, "/shop/cart")
        assert _allowed(robots, "/shop/offers/week")
        assert _allowed(robots, "/x")

    def test_comments_case_and_spacing(self) -> None:
        robots = "USER-AGENT : *   # everyone\n\n  disallow:/private  # keep out\n"
        assert not _allowed(robots, "/private")


class TestGroups:
    ROBOTS = (
        "User-agent: SomeBot\nUser-agent: Chrome\nDisallow: /for-browsers\n\n"
        "User-agent: *\nDisallow: /for-everyone\n\n"
        "User-agent: chrome\nDisallow: /more\n"
    )

    def test_named_groups_replace_the_fallback_and_merge(self) -> None:
        assert not _allowed(self.ROBOTS, "/for-browsers")
        assert not _allowed(self.ROBOTS, "/more")
        assert _allowed(self.ROBOTS, "/for-everyone")

    def test_fallback_for_other_agents(self) -> None:
        assert _allowed(self.ROBOTS, "/for-browsers", agent="curl/8")
        assert not _allowed(self.ROBOTS, "/for-everyone", agent="curl/8")

    def test_named_group_without_rules_allows_everything(self) -> None:
        robots = "User-agent: Chrome\nDisallow:\n\nUser-agent: *\nDisallow: /\n"
        assert _allowed(robots, "/page")
        assert not _allowed(robots, "/page", agent="curl/8")
