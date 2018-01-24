import React, { Component } from 'react'
import './Viewer.css'

class App extends Component {
  componentDidMount() {
    const video = document.createElement('video')
    video.setAttribute('src', './city.mp4')
    video.setAttribute('loop', true)
    video.setAttribute('muted', true)
    video.setAttribute('autoplay', true)

    const { FramelessVideoViewer } = window.PanoGL
    const viewer = new FramelessVideoViewer({
      el: '#viewer',
      src: video,
      camera: {
        type: 'panini'
      }
    })
  }

  render() {
    return <div className="viewer" id="viewer"></div>
  }
}

export default App
