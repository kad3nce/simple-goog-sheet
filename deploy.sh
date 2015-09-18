#!/bin/bash
echo '~> Building'
./build.sh
echo '~> Pushing'
docker push kad3nce/simple-goog-sheet
echo '~> Deploying'
ssh root@appdocker 'docker pull kad3nce/simple-goog-sheet'
