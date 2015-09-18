FROM node:4.0
MAINTAINER Jedidiah Hurt <jed.hurt@gmail.com>

RUN npm install -g babel

RUN mkdir /app
ADD package.json /app/package.json
RUN cd /app && npm install

WORKDIR /app
ADD . /app

CMD ["babel-node", "index.js"]
