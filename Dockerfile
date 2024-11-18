FROM node:18-buster-slim
EXPOSE 3000

# Install basic dependencies
RUN apt-get update --fix-missing -y \
    && apt-get install -y --no-install-recommends \
    dumb-init \
    openssl \
    gpg \
    wget gnupg ca-certificates fonts-liberation \
    ca-certificates fonts-liberation libappindicator3-1 libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils apt-transport-https

# Manually download and install Google Chrome
RUN wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -O /tmp/google-chrome.deb \
    && dpkg -i /tmp/google-chrome.deb || apt-get install -y --no-install-recommends -f \
    && rm -rf /tmp/google-chrome.deb

# Clean up APT cache
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

RUN wget --quiet https://raw.githubusercontent.com/vishnubob/wait-for-it/master/wait-for-it.sh -O /usr/sbin/wait-for-it.sh \
    && chmod +x /usr/sbin/wait-for-it.sh \

    && groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser 


# Run everything after as non-privileged user.
USER pptruser
WORKDIR /home/pptruser
RUN npm i puppeteer --verbose --f
COPY package.json .
RUN npm i --verbose --f
COPY --chown=pptruser:pptruser . .
RUN npm run build


CMD ["node","build/rendertron.js"]