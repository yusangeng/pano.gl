import React, { Component } from 'react'
import './App.css'

class App extends Component {
  componentDidMount() {
    const video = document.createElement('video')
    video.setAttribute('src', './city.mp4')
    video.setAttribute('loop', true)
    video.setAttribute('muted', true)
    video.setAttribute('autoplay', true)

    const { FramelessVideoViewer } = window.PanoGL
    const viewer = new FramelessVideoViewer({
      el: '#banner-viewer',
      src: video,
      camera: {
        type: 'panini'
      }
    })
  }

  render() {
    return <div className="app">
      <div id="banner-viewer" className="banner-viewer">
      </div>
      <div className="npm-link">
        <a href="https://www.npmjs.com/package/pano.gl">
          <img src="https://nodei.co/npm/pano.gl.png?compact=true" />
        </a>
      </div>
      <div className="text">
        <h1>pano.gl</h1>
        <h3>javascript & panorama.</h3>
      </div>
    </div>
  }
}

export default App
