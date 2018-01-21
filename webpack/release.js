var webpack = require('webpack')
var path = require('path')
var UglifyJSPlugin = webpack.optimize.UglifyJsPlugin
var BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin

var config = {
  entry: path.resolve(__dirname, '../src/index.js'),
  output: {
    library: 'PanoGL',
    libraryTarget: 'umd',
    path: path.resolve(__dirname, '../.package'),
    filename: 'bundle.min.js',
    umdNamedDefine: true
  },

  devtool: 'source-map',

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
    new UglifyJSPlugin({
      mangle: {
        // Skip mangling these
        except: ['$super', '$', 'exports', 'require']
      },
      sourceMap: true
    }),

    new BundleAnalyzerPlugin({
      analyzerMode: 'static',
      reportFilename: 'BundleSizeRelease.html',
      logLevel: 'info'
    })
  ]
}

module.exports = config
