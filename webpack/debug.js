var path = require('path')

var config = {
  entry: path.resolve(__dirname, '../src/index.js'),
  output: {
    library: 'PanoGL',
    libraryTarget: 'umd',
    path: path.resolve(__dirname, '../.package'),
    filename: 'bundle.js',
    umdNamedDefine: true
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
      }
    ]
  },

  plugins: []
}

module.exports = config
