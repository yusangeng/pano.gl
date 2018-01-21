var path = require('path')

var config = {
  entry: path.resolve(__dirname, './index.js'),
  output: {
    path: path.resolve(__dirname, './'),
    filename: 'bundle.js',
    publicPath: 'demo'
  },

  devtool: 'inline-source-map',

  module: {
    rules: [
      {
        test: /\.js$/,
        use: [
          'babel-loader'
        ],
        exclude: /node_modules/
      },
      {
        test: /\.glsl$/,
        loader: 'webpack-glsl-loader'
      }
    ]
  },

  devServer: {
    inline: true,
    port: 9900
  },

  plugins: [
  ]
}

module.exports = config
