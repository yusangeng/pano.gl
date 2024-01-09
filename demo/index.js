
import { mix } from 'mix-with'
import Eventable from 'refra/lib/mixin/Eventable'
import delegate from 'dodele/lib/decorator/delegate'
import callback from 'dodele/lib/decorator/callback'
import ImageViewer from '../src/FramelessImageViewer'
import VideoViewer from '../src/FramelessVideoViewer'

@delegate
class ImageViewerWrap extends mix().with(Eventable) {
  constructor() {
    super()

    this.viewer = new ImageViewer({
      el: '#image-view',
      src: './image/8192x4096.jpg',
      camera: {
        type: 'perspective'
      }
    })
  }

  @callback('click', '.j-8192')
  on8192Click() {
    this.viewer.src = './image/8192x4096.jpg'
  }

  @callback('click', '.j-4096')
  on4096Click() {
    this.viewer.src = './image/4096x2048.jpg'
  }

  @callback('click', '.j-2048')
  on2048Click() {
    this.viewer.src = './image/2048x1024.jpg'
  }

  @callback('click', '.j-perspective')
  onPerspective() {
    const { el } = this.viewer

    this.viewer.cameraOptions = {
      type: 'perspective'
    }
  }

  /*
  @callback('click', '.j-ortho')
  onOrtho() {
    this.viewer.cameraOptions = {
      type: 'ortho'
    }
  }
  */

  @callback('click', '.j-cylindrical')
  onCylindrical() {
    this.viewer.cameraOptions = {
      type: 'cylindrical'
    }
  }

  @callback('click', '.j-planet')
  onPlanet() {
    this.viewer.cameraOptions = {
      type: 'planet'
    }
  }

  @callback('click', '.j-pannini')
  onpannini() {
    this.viewer.cameraOptions = {
      type: 'pannini'
    }
  }
}

@delegate
class VideoViewerWrap extends mix().with(Eventable) {
  constructor() {
    super()

    const video = this.video = document.createElement('video')
    video.setAttribute('src', './video/city.mp4')
    video.setAttribute('loop', true)
    video.setAttribute('muted', true)

    this.viewer = new VideoViewer({
      el: '#video-view',
      src: video,
      camera: {
        type: 'perspective'
      }
    })
  }

  @callback('click', '.j-start')
  onStartClick() {
    this.video.play()
  }

  @callback('click', '.j-pause')
  onPauseClick() {
    this.video.pause()
  }

  @callback('click', '.j-audio')
  onAudioClick() {
    this.video.muted = !this.video.muted
  }

  @callback('click', '.j-video-perspective')
  onPerspective() {
    const { el } = this.viewer

    this.viewer.cameraOptions = {
      type: 'perspective'
    }
  }

  /*
  @callback('click', '.j-video-ortho')
  onOrtho() {
    this.viewer.cameraOptions = {
      type: 'ortho'
    }
  }
  */

  @callback('click', '.j-video-cylindrical')
  onCylindrical() {
    this.viewer.cameraOptions = {
      type: 'cylindrical'
    }
  }

  @callback('click', '.j-video-planet')
  onPlanet() {
    this.viewer.cameraOptions = {
      type: 'planet'
    }
  }

  @callback('click', '.j-video-pannini')
  onpannini() {
    this.viewer.cameraOptions = {
      type: 'pannini'
    }
  }
}

window.imageViewerWrap = new ImageViewerWrap(document.querySelector('.image-view-wrap'))
window.videoViewerWrap = new VideoViewerWrap(document.querySelector('.video-view-wrap'))
