#!/usr/bin/env sh

cd /root/sprig/custom-firmware/xenon
./src/pc/jerry/refresh.sh

cd /root/sprig/custom-firmware/xenon
./src/rpi/jerry/refresh.sh

touch game.js

mkdir -p src/build
mkdir -p src/shared/sprig_engine/build
./tools/cstringify.py ./src/shared/sprig_engine/engine.js > ./src/shared/sprig_engine/build/engine.min.js.cstring

cmake --preset=rpi
cmake --build --preset=rpi

cp rpi_build/src/xenon.uf2 ~/xenon.uf2
cp ~/firmware.uf2 firmware.uf2
cp rpi_build/src/xenon.elf ~/xenon.elf
cp ~/xenon.elf xenon.elf