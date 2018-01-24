import React, { Component } from 'react'
import Viewer from './Viewer'
import Caption from './Caption'
import './App.css'

export default class App extends Component {
  render() {
    return <div className="app">
      <Viewer />
      <Caption />
    </div>
  }
}
