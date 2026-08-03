window.API_TESTING_CONFIG = {
  provider: "weather",
  title: "Weather",
  description: "WeatherAPI.com current conditions and forecast.",
  endpoints: [
  {
    "id": "weather-api",
    "name": "Weather API",
    "folder": null,
    "method": "GET",
    "pathTemplate": "/v1/current.json",
    "pathParams": [],
    "queryParams": [
      {
        "key": "q",
        "example": "bn131lw",
        "required": true
      },
      {
        "key": "days",
        "example": "1",
        "required": true
      }
    ]
  }
],
};
