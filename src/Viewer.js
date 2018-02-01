import React, { Component } from 'react'
import './Viewer.css'

function isMobile () {
  const u = navigator.userAgent;
  const isAndroid = u.indexOf('Android') > -1 || u.indexOf('Adr') > -1; //android终端
  const isiOS = !!u.match(/\(i[^;]+;( U;)? CPU.+Mac OS X/); //ios终端

  return isAndroid || isiOS
}

class App extends Component {
  componentDidMount() {

    if (isMobile()) {
      this.initImageViewer()
    } else {
      this.initVideoViewer()
    }
  }

  initImageViewer() {
    const { FramelessImageViewer } = window.PanoGL
    this.viewer_ = new FramelessImageViewer({
      el: '#viewer',
      src: './2048x1024.jpg',
      camera: {
        type: 'planet'
      }
    })
  }

  initVideoViewer() {
    const video = document.createElement('video')
    video.setAttribute('src', './city.mp4')
    video.setAttribute('loop', true)
    video.setAttribute('muted', true)
    video.setAttribute('autoplay', true)

    const { FramelessVideoViewer } = window.PanoGL
    this.viewer_ = new FramelessVideoViewer({
      el: '#viewer',
      src: video,
      camera: {
        type: 'pannini'
      }
    })
  }

  componentWillUnmount() {
    this.viewer_.dispose()
    this.viewer_ = null
  }

  render() {
    return <div className="viewer" id="viewer"></div>
  }
}

export default App
