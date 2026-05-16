FROM node:22-bookworm

# 1. Install system dependencies (as root)
RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# 2. Install GitHub CLI (as root)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# 3. Setup Build-args for UID/GID alignment
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID
RUN groupmod -g $AGENT_GID node && usermod -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node

# -------------------------------------------------------------
# SWITCH TO UNPRIVILEGED AGENT USER
# All tools installed below this point will belong to 'agent'
# -------------------------------------------------------------
USER ${AGENT_UID}:${AGENT_GID}
WORKDIR /home/agent

# 4. Install Bun (as agent)
RUN curl -fsSL https://bun.sh/install | bash

# 5. Install Claude Code CLI (as agent)
RUN curl -fsSL https://claude.ai/install.sh | bash

# 6. Configure combined PATH environment variables for the agent
ENV PATH="/home/agent/.bun/bin:/home/agent/.local/bin:${PATH}"

# Entrypoint setup for Sandcastle worktree sandbox
ENTRYPOINT ["sleep", "infinity"]