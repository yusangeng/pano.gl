# pano.gl

Equirectangular video/image viewer based on WebGL.

[![Build Status](https://travis-ci.org/yusangeng/pano.gl.svg?branch=master)](https://travis-ci.org/yusangeng/pano.gl) [![Standard - JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

[![Npm Info](https://nodei.co/npm/pano.gl.png?compact=true)](https://www.npmjs.com/package/pano.gl)

## Features

* Pure javascript.
* Multiple camera models: perspective/cylindrical/planet/pannini.

## Install

``` shell
npm install pano.gl --save
```

## Build

``` shell
git clone https://github.com/yusangeng/pano.gl.git
cd pano.gl
npm i
npm run build
```

The bundle files should be in `./.package`.

## Usage

### Image Viewer

``` js
import FramelessImageViewer 'pano.gl/lib/FramelessImageViewer'

const viewer = new FramelessImageViewer({
  el: '#image-viewer-wrap', // container DOM element.
  src: '//www.foobar.com/path/to/image',
  camera: {
    type: 'perspective' // perspective/cylindrical/planet/pannini.
  }
})
```

### Video Viewer

``` js
import FramelessVideoViewer 'pano.gl/lib/FramelessVideoViewer'

const viewer = new FramelessImageViewer({
  el: '#video-viewer-wrap', // container DOM element.
  src: '#video', // <video /> DOM element as texture data source.
  camera: {
    type: 'perspective' // perspective/cylindrical/planet/pannini.
  }
})
```

### Switching Camera

``` js
viewer.cameraOptions = {
  type: 'cylindrical' // perspective/cylindrical/planet/pannini.
}
```

### Rotating Camera

``` js
const deltaX = 1
const deltaY = 2

viewer.rotate(deltaX, deltaY)
```

### Zooming Camera

``` js
const delta = 0.1

viewer.zoom(delta)
```

### Enabling / Disabling PTZ

``` js
// true: PTZ Enabled, false: PTZ disabled.
viewer.PTZ = false
```
