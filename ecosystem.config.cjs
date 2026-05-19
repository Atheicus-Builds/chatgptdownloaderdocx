module.exports = {
  apps: [
    {
      name: "chatgptdownloaderdocx",
      script: "server.js",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3000",
        BASE_PATH: "/builds/chatgptdownloaderdocx"
      }
    }
  ]
};
