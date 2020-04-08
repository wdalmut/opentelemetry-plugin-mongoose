# OpenTelemetry Mongoose Plugin

[![Build Status](https://travis-ci.org/wdalmut/opentelemetry-plugin-mongoose.svg?branch=master)](https://travis-ci.org/wdalmut/opentelemetry-plugin-mongoose)

Just a mongoose plugin for opentelemetry

## Installation

```sh
npm install --save @wdalmut/opentelemetry-plugin-mongoose
```

## Usage

```js
const provider = new NodeTracerProvider({
  plugins: {
    mongoose: {
      enabled: true,
      path: '@wdalmut/opentelemetry-plugin-mongoose',
    },
  }
});
```

## Status

This project is in alpha state. Do not use in production if your are not sure
about what are you doing...
