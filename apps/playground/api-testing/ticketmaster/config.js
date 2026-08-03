window.API_TESTING_CONFIG = {
  provider: "ticketmaster",
  title: "Ticketmaster Discovery",
  description: "Search events, attractions, venues, and classifications via Ticketmaster's Discovery API v2.",
  endpoints: [
  {
    "id": "search-events",
    "name": "Search Events",
    "folder": "Events",
    "method": "GET",
    "pathTemplate": "/events.json",
    "pathParams": [],
    "queryParams": [
      {
        "key": "classificationName",
        "example": "music",
        "required": false
      },
      {
        "key": "dmaId",
        "example": "324",
        "required": false
      },
      {
        "key": "postalCode",
        "example": "90015",
        "required": false
      },
      {
        "key": "radius",
        "example": "25",
        "required": false
      },
      {
        "key": "unit",
        "example": "miles",
        "required": false
      },
      {
        "key": "startDateTime",
        "example": "2026-01-01T00:00:00Z",
        "required": false
      },
      {
        "key": "endDateTime",
        "example": "2026-12-31T23:59:59Z",
        "required": false
      },
      {
        "key": "size",
        "example": "20",
        "required": true
      },
      {
        "key": "page",
        "example": "0",
        "required": true
      },
      {
        "key": "sort",
        "example": "date,asc",
        "required": false
      },
      {
        "key": "includeSpellcheck",
        "example": "yes",
        "required": false
      },
      {
        "key": "keyword",
        "example": "",
        "required": true
      },
      {
        "key": "countryCode",
        "example": "",
        "required": true
      }
    ]
  },
  {
    "id": "get-event-details",
    "name": "Get Event Details",
    "folder": "Events",
    "method": "GET",
    "pathTemplate": "/events/:eventId.json",
    "pathParams": [
      "eventId"
    ],
    "queryParams": []
  },
  {
    "id": "get-event-images",
    "name": "Get Event Images",
    "folder": "Events",
    "method": "GET",
    "pathTemplate": "/events/:eventId/images.json",
    "pathParams": [
      "eventId"
    ],
    "queryParams": []
  },
  {
    "id": "search-attractions",
    "name": "Search Attractions",
    "folder": "Attractions",
    "method": "GET",
    "pathTemplate": "/attractions.json",
    "pathParams": [],
    "queryParams": [
      {
        "key": "keyword",
        "example": "metallica",
        "required": true
      },
      {
        "key": "size",
        "example": "20",
        "required": true
      },
      {
        "key": "page",
        "example": "0",
        "required": true
      },
      {
        "key": "sort",
        "example": "name,asc",
        "required": false
      },
      {
        "key": "includeSpellcheck",
        "example": "yes",
        "required": false
      }
    ]
  },
  {
    "id": "get-attraction-details",
    "name": "Get Attraction Details",
    "folder": "Attractions",
    "method": "GET",
    "pathTemplate": "/attractions/:attractionId.json",
    "pathParams": [
      "attractionId"
    ],
    "queryParams": []
  },
  {
    "id": "search-venues",
    "name": "Search Venues",
    "folder": "Venues",
    "method": "GET",
    "pathTemplate": "/venues.json",
    "pathParams": [],
    "queryParams": [
      {
        "key": "keyword",
        "example": "O2",
        "required": true
      },
      {
        "key": "countryCode",
        "example": "GB",
        "required": true
      },
      {
        "key": "postalCode",
        "example": "SE10 0DX",
        "required": false
      },
      {
        "key": "size",
        "example": "20",
        "required": true
      },
      {
        "key": "page",
        "example": "0",
        "required": true
      },
      {
        "key": "sort",
        "example": "name,asc",
        "required": false
      }
    ]
  },
  {
    "id": "get-venue-details",
    "name": "Get Venue Details",
    "folder": "Venues",
    "method": "GET",
    "pathTemplate": "/venues/:venueId.json",
    "pathParams": [
      "venueId"
    ],
    "queryParams": []
  },
  {
    "id": "search-classifications",
    "name": "Search Classifications",
    "folder": "Classifications",
    "method": "GET",
    "pathTemplate": "/classifications.json",
    "pathParams": [],
    "queryParams": [
      {
        "key": "keyword",
        "example": "music",
        "required": true
      },
      {
        "key": "size",
        "example": "20",
        "required": true
      },
      {
        "key": "page",
        "example": "0",
        "required": true
      }
    ]
  },
  {
    "id": "get-classification-details",
    "name": "Get Classification Details",
    "folder": "Classifications",
    "method": "GET",
    "pathTemplate": "/classifications/:classificationId.json",
    "pathParams": [
      "classificationId"
    ],
    "queryParams": []
  },
  {
    "id": "get-segment-details",
    "name": "Get Segment Details",
    "folder": "Classifications",
    "method": "GET",
    "pathTemplate": "/classifications/segments/:segmentId.json",
    "pathParams": [
      "segmentId"
    ],
    "queryParams": []
  },
  {
    "id": "get-genre-details",
    "name": "Get Genre Details",
    "folder": "Classifications",
    "method": "GET",
    "pathTemplate": "/classifications/genres/:genreId.json",
    "pathParams": [
      "genreId"
    ],
    "queryParams": []
  },
  {
    "id": "get-sub-genre-details",
    "name": "Get Sub-Genre Details",
    "folder": "Classifications",
    "method": "GET",
    "pathTemplate": "/classifications/subgenres/:subGenreId.json",
    "pathParams": [
      "subGenreId"
    ],
    "queryParams": []
  },
  {
    "id": "find-suggest",
    "name": "Find Suggest",
    "folder": "Suggest",
    "method": "GET",
    "pathTemplate": "/suggest.json",
    "pathParams": [],
    "queryParams": [
      {
        "key": "keyword",
        "example": "ade",
        "required": true
      },
      {
        "key": "countryCode",
        "example": "US",
        "required": true
      },
      {
        "key": "resource",
        "example": "events,attractions,venues",
        "required": false
      },
      {
        "key": "size",
        "example": "5",
        "required": true
      },
      {
        "key": "includeSpellcheck",
        "example": "yes",
        "required": false
      }
    ]
  }
],
};
