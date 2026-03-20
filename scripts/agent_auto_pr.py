#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import subprocess
import sys
from typing import Iterable


AGENT_PATTERN = re.compile(r"\[agent:([a-zA-Z0-9_.-]+)\]")


def run(cmd: list[str], check: bool = True) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if check and result.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{result.stderr.strip()}")
    return result.stdout.strip()


def detect_base_branch() -> str:
    preferred = os.getenv("BASE_BRANCH", "main")
    for candidate in [preferred, "main", "master"]:
        try:
            run(["git", "show-ref", "--verify", "--quiet", f"refs/remotes/origin/{candidate}"])
            return candidate
        except RuntimeError:
            continue
    raise RuntimeError("Cannot find base branch in origin (tried BASE_BRANCH/main/master).")


def collect_agents(base_branch: str) -> set[str]:
    commit_bodies = run(["git", "log", "--pretty=%B", f"origin/{base_branch}..HEAD"])
    agents = {match.group(1) for match in AGENT_PATTERN.finditer(commit_bodies)}
    return agents


def build_pr_body(agents: Iterable[str], base_branch: str, head_branch: str) -> str:
    agent_lines = "\n".join(f"- `{agent}`" for agent in sorted(agents))
    return (
        "This PR was opened automatically after agent collaboration commits were detected.\n\n"
        f"- Base branch: `{base_branch}`\n"
        f"- Head branch: `{head_branch}`\n"
        "- Detected agents:\n"
        f"{agent_lines}\n\n"
        "Validation rule:\n"
        "- At least 1 `[agent:<id>]` marker in commit messages\n"
    )


def main() -> int:
    repo = os.getenv("GITHUB_REPOSITORY")
    head_branch = os.getenv("GITHUB_REF_NAME")
    required_count = int(os.getenv("REQUIRED_AGENT_COUNT", "1"))
    required_test_agent = os.getenv("REQUIRED_TEST_AGENT", "").strip()

    if not repo or not head_branch:
        print("Missing GITHUB_REPOSITORY or GITHUB_REF_NAME, skip.")
        return 0

    run(["git", "fetch", "origin", "--prune"], check=True)
    base_branch = detect_base_branch()

    agents = collect_agents(base_branch)
    print(f"Detected agents: {sorted(agents)}")

    if len(agents) < required_count:
        print(f"Skip PR creation: need >= {required_count} unique agents.")
        return 0
    if required_test_agent and required_test_agent not in agents:
        print(f"Skip PR creation: missing required test agent '{required_test_agent}'.")
        return 0

    existing_pr = run(
        [
            "gh",
            "pr",
            "list",
            "--repo",
            repo,
            "--head",
            head_branch,
            "--json",
            "number",
            "--jq",
            ".[0].number",
        ],
        check=False,
    )
    if existing_pr:
        print(f"PR already exists: #{existing_pr}")
        return 0

    title = f"auto: agent update from {head_branch}"
    body = build_pr_body(agents=agents, base_branch=base_branch, head_branch=head_branch)
    run(
        [
            "gh",
            "pr",
            "create",
            "--repo",
            repo,
            "--base",
            base_branch,
            "--head",
            head_branch,
            "--title",
            title,
            "--body",
            body,
        ]
    )
    print("PR created successfully.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pylint: disable=broad-except
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
