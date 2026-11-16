"""robots.txt matching as in RFC 9309, including the `*` and `$` wildcards in paths.

`urllib.robotparser` compares rule paths as plain prefixes, so a rule like
`Disallow: /*.klstorefinder*` never matches there.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Rule:
    allow: bool
    pattern: str

    def matches(self, path: str) -> bool:
        return _compile(self.pattern).match(path) is not None


def _compile(pattern: str) -> re.Pattern[str]:
    anchored = pattern.endswith("$")
    body = pattern[:-1] if anchored else pattern
    regex = ".*".join(re.escape(part) for part in body.split("*"))
    return re.compile(regex + ("$" if anchored else ""), re.DOTALL)


def parse_rules(robots_txt: str, user_agent: str) -> list[Rule]:
    """Rules of every group that applies to `user_agent`.

    A group applies if one of its product tokens occurs in the user agent string (ignoring case);
    if no group does, the `*` group applies. Groups for the same agent are merged.
    """
    agent = user_agent.lower()
    named: list[Rule] = []
    fallback: list[Rule] = []
    named_group = False  # a group names this agent, even if it has no rules
    tokens: list[str] = []  # user-agent lines of the group being read
    in_rules = False  # the current group already has rule lines
    for raw in robots_txt.splitlines():
        line = raw.split("#", 1)[0].strip()
        key, sep, value = line.partition(":")
        if not sep:
            continue
        key, value = key.strip().lower(), value.strip()
        if key == "user-agent":
            if in_rules:
                tokens, in_rules = [], False
            tokens.append(value.lower())
            named_group = named_group or _names(value.lower(), agent)
        elif key in ("allow", "disallow"):
            in_rules = True
            if not value:  # "Disallow:" without a path restricts nothing
                continue
            rule = Rule(allow=key == "allow", pattern=value)
            if any(_names(t, agent) for t in tokens):
                named.append(rule)
            elif "*" in tokens:
                fallback.append(rule)
    return named if named_group else fallback


def _names(token: str, agent: str) -> bool:
    return token not in ("", "*") and token in agent


def is_allowed(rules: list[Rule], path: str) -> bool:
    """Whether `path` (with its query string, if any) may be fetched.

    The longest matching pattern decides; an Allow rule wins a tie. No match means allowed.
    """
    best: Rule | None = None
    for rule in rules:
        if not rule.matches(path):
            continue
        if (
            best is None
            or len(rule.pattern) > len(best.pattern)
            or (len(rule.pattern) == len(best.pattern) and rule.allow)
        ):
            best = rule
    return best is None or best.allow
