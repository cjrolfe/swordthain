window.API_TESTING_CONFIG = {
  title: "Vehicle APIs",
  description: "Look up vehicle details by registration number, via DVLA's VES (tax/MOT/technical details) and DVSA's MOT History API.",
  endpoints: [
    {
      id: "vehicle-details",
      provider: "ves-uat",
      name: "VES — Vehicle Details (UAT / test)",
      folder: null,
      method: "POST",
      pathParams: [],
      queryParams: [],
      bodyParams: [
        {
          key: "registrationNumber",
          label: "Car Reg Number",
          example: "AA19AAA",
          required: true,
        },
      ],
    },
    {
      id: "vehicle-details",
      provider: "ves-production",
      name: "VES — Vehicle Details (Production — real DVLA data)",
      folder: null,
      method: "POST",
      pathParams: [],
      queryParams: [],
      bodyParams: [
        {
          key: "registrationNumber",
          label: "Car Reg Number",
          example: "",
          required: true,
        },
      ],
    },
    {
      id: "mot-history-lookup",
      provider: "mot-history",
      name: "MOT History (DVSA)",
      folder: null,
      method: "GET",
      pathParams: [
        {
          key: "registration",
          label: "Car Reg Number",
          example: "AA19AAA",
          required: true,
        },
      ],
      queryParams: [],
      bodyParams: [],
    },
  ],
};
