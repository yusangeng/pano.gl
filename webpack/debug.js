var path = require('path')
var BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin

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
      },
      {
        test: /\.glsl$/,
        loader: 'webpack-glsl-loader'
      }
    ]
  },

  plugins: [
    new BundleAnalyzerPlugin({
      analyzerMode: 'static',
      reportFilename: 'BundleSizeDebug.html',
      logLevel: 'info'
    })
  ]
}

module.exports = config
