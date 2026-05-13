#!/bin/zsh
cd "$(dirname "$0")"
python3 -m http.server 4173
