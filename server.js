 require("dotenv").config();

const express = require("express");
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_NAME = process.env.DB_NAME || "PackSmartdb";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

let db;
let tripsCollection;

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const radians = value => value * Math.PI / 180;
  const earthRadius = 6371;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) *
      Math.cos(radians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return Number(
    (earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1)
  );
}

function formatPlaceType(type) {
  const labels = {
    attraction: "Attraction",
    museum: "Museum",
    viewpoint: "Viewpoint",
    zoo: "Zoo",
    theme_park: "Theme Park",
    gallery: "Art Gallery",
    aquarium: "Aquarium",
    park: "Park",
    waterfall: "Waterfall",
    peak: "Mountain",
    beach: "Beach",
    place_of_worship: "Place of Worship",
    vineyard: "Vineyard",
    church: "Church",
    temple: "Temple",
    monument: "Historical Monument",
    castle: "Historical Site",
    ruins: "Historical Ruins",
    archaeological_site: "Archaeological Site"
  };

  return labels[type] ||
    String(type || "Attraction")
      .replace(/_/g, " ")
      .replace(/\b\w/g, letter => letter.toUpperCase());
}

async function findDestinationInWikidata(destination) {
  const searchUrl = new URL("https://www.wikidata.org/w/api.php");
  searchUrl.searchParams.set("action", "wbsearchentities");
  searchUrl.searchParams.set("search", destination);
  searchUrl.searchParams.set("language", "en");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("limit", "5");

  const searchResponse = await fetchWithTimeout(
    searchUrl.toString(),
    {
      headers: {
        "User-Agent": "PackSmartTravelPlanner/1.0 (educational project)"
      }
    },
    5000
  );

  if (!searchResponse.ok) {
    throw new Error("Backup geocoder search failed.");
  }

  const searchData = await searchResponse.json();
  const ids = (searchData.search || [])
    .map(item => item.id)
    .filter(Boolean);

  for (const id of ids) {
    try {
      const entityUrl = new URL("https://www.wikidata.org/w/api.php");
      entityUrl.searchParams.set("action", "wbgetentities");
      entityUrl.searchParams.set("ids", id);
      entityUrl.searchParams.set("props", "claims|labels");
      entityUrl.searchParams.set("languages", "en");
      entityUrl.searchParams.set("format", "json");

      const entityResponse = await fetchWithTimeout(
        entityUrl.toString(),
        {
          headers: {
            "User-Agent": "PackSmartTravelPlanner/1.0 (educational project)"
          }
        },
        4000
      );

      if (!entityResponse.ok) continue;

      const entityData = await entityResponse.json();
      const entity = entityData.entities?.[id];
      const coordinate =
        entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;

      if (
        coordinate &&
        Number.isFinite(Number(coordinate.latitude)) &&
        Number.isFinite(Number(coordinate.longitude))
      ) {
        return {
          name: entity.labels?.en?.value || destination,
          latitude: Number(coordinate.latitude),
          longitude: Number(coordinate.longitude)
        };
      }
    } catch (error) {
      console.log("Backup geocoder item failed:", error.message);
    }
  }

  return null;
}

async function findDestination(destination) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", destination);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  try {
    const response = await fetchWithTimeout(
      url.toString(),
      {
        headers: {
          "User-Agent": "PackSmartTravelPlanner/1.0 (educational project)"
        }
      },
      8000
    );

    if (!response.ok) {
      throw new Error(`Location service returned HTTP ${response.status}`);
    }

    const results = await response.json();

    if (results.length) {
      return {
        name: results[0].display_name,
        latitude: Number(results[0].lat),
        longitude: Number(results[0].lon)
      };
    }

    throw new Error("Destination not found in the live location service.");
  } catch (error) {
    console.log("Primary location lookup failed:", error.message);
  }

  try {
    const backupLocation = await findDestinationInWikidata(destination);

    if (backupLocation) {
      console.log("Destination resolved using Wikidata backup.");
      return backupLocation;
    }
  } catch (error) {
    console.log("Backup location lookup failed:", error.message);
  }

  const normalized = destination.toLowerCase();

  if (/goa|panaji|panjim|calangute|candolim|baga beach|anjuna/i.test(normalized)) {
    return {
      name: "Goa, India (built-in location fallback)",
      latitude: 15.4909,
      longitude: 73.8278
    };
  }

  if (/nashik|nasik/i.test(normalized)) {
    return {
      name: "Nashik, Maharashtra, India (built-in location fallback)",
      latitude: 20.0059,
      longitude: 73.7897
    };
  }

  throw new Error(
    "Could not locate this destination. Both live and backup location services were unavailable or had no matching coordinates. Please check the spelling and internet connection."
  );
}

async function getWeather(latitude, longitude) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code"
  );
  url.searchParams.set("timezone", "auto");

  try {
    const response = await fetchWithTimeout(url.toString(), {}, 10000);

    if (!response.ok) {
      throw new Error(`Weather service returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const current = data.current;

    if (!current) {
      throw new Error("Current weather data is unavailable.");
    }

    const descriptions = {
      0: "Clear sky",
      1: "Mainly clear",
      2: "Partly cloudy",
      3: "Overcast",
      45: "Foggy",
      48: "Foggy",
      51: "Light drizzle",
      53: "Drizzle",
      55: "Heavy drizzle",
      61: "Light rain",
      63: "Rain",
      65: "Heavy rain",
      71: "Light snow",
      73: "Snow",
      75: "Heavy snow",
      80: "Rain showers",
      81: "Rain showers",
      82: "Heavy rain showers",
      95: "Thunderstorm",
      96: "Thunderstorm with hail",
      99: "Thunderstorm with hail"
    };

    const code = current.weather_code;
    const description = descriptions[code] || "Current weather";
    let icon = "🌤️";

    if ([0, 1].includes(code)) icon = "☀️";
    else if ([2, 3].includes(code)) icon = "☁️";
    else if ([45, 48].includes(code)) icon = "🌫️";
    else if (code >= 71 && code <= 77) icon = "❄️";
    else if (code >= 95) icon = "⛈️";
    else if (code >= 51 && code <= 82) icon = "🌧️";

    return {
      temperature: current.temperature_2m,
      description,
      humidity: current.relative_humidity_2m ?? "--",
      wind: current.wind_speed_10m ?? 0,
      icon,
      available: true,
      source: "Open-Meteo"
    };
  } catch (error) {
    console.log("Weather request failed:", error.message);

    return {
      temperature: null,
      description: "Weather unavailable",
      humidity: "--",
      wind: 0,
      icon: "🌤️",
      available: false,
      source: "Fallback"
    };
  }
}

function getBuiltInAttractions(latitude, longitude, destinationName = "") {
  const destinations = [
    {
      name: "Nashik",
      latitude: 20.0059,
      longitude: 73.7897,
      aliases: ["nashik", "nasik"],
      places: [
        {
          name: "Pandav Leni Caves",
          type: "Historical Attraction",
          latitude: 19.9638,
          longitude: 73.7592
        },
        {
          name: "Sula Vineyards",
          type: "Vineyard",
          latitude: 20.0063,
          longitude: 73.7455
        },
        {
          name: "Kalaram Temple",
          type: "Temple",
          latitude: 19.9975,
          longitude: 73.7898
        },
        {
          name: "Ramkund",
          type: "Religious Attraction",
          latitude: 20.0059,
          longitude: 73.7903
        },
        {
          name: "Someshwar Waterfall",
          type: "Waterfall",
          latitude: 20.0057,
          longitude: 73.6977
        },
        {
          name: "Trimbakeshwar Temple",
          type: "Temple",
          latitude: 19.9322,
          longitude: 73.5307
        },
        {
          name: "Anjaneri Hills",
          type: "Mountain / Trekking",
          latitude: 19.9417,
          longitude: 73.5574
        },
        {
          name: "Gangapur Dam",
          type: "Scenic Spot",
          latitude: 20.0250,
          longitude: 73.6760
        }
      ]
    },
    {
      name: "Goa",
      latitude: 15.4909,
      longitude: 73.8278,
      aliases: [
        "goa",
        "north goa",
        "south goa",
        "panaji",
        "panjim",
        "margao",
        "madgaon",
        "calangute",
        "candolim",
        "vasco da gama"
      ],
      places: [
        {
          name: "Fort Aguada",
          type: "Historical Attraction",
          latitude: 15.4923,
          longitude: 73.7737
        },
        {
          name: "Basilica of Bom Jesus",
          type: "Church",
          latitude: 15.5009,
          longitude: 73.9115
        },
        {
          name: "Dona Paula Viewpoint",
          type: "Viewpoint",
          latitude: 15.4589,
          longitude: 73.8050
        },
        {
          name: "Chapora Fort",
          type: "Historical Attraction",
          latitude: 15.6067,
          longitude: 73.7391
        },
        {
          name: "Baga Beach",
          type: "Beach",
          latitude: 15.5553,
          longitude: 73.7517
        },
        {
          name: "Anjuna Beach",
          type: "Beach",
          latitude: 15.5736,
          longitude: 73.7400
        },
        {
          name: "Calangute Beach",
          type: "Beach",
          latitude: 15.5439,
          longitude: 73.7553
        },
        {
          name: "Candolim Beach",
          type: "Beach",
          latitude: 15.5181,
          longitude: 73.7626
        },
        {
          name: "Se Cathedral",
          type: "Historical Church",
          latitude: 15.5038,
          longitude: 73.9120
        },
        {
          name: "Fontainhas Latin Quarter",
          type: "Heritage Area",
          latitude: 15.4988,
          longitude: 73.8302
        },
        {
          name: "Reis Magos Fort",
          type: "Historical Attraction",
          latitude: 15.5045,
          longitude: 73.8000
        },
        {
          name: "Miramar Beach",
          type: "Beach",
          latitude: 15.4777,
          longitude: 73.8077
        },
        {
          name: "Palolem Beach",
          type: "Beach",
          latitude: 15.0100,
          longitude: 74.0232
        },
        {
          name: "Colva Beach",
          type: "Beach",
          latitude: 15.2798,
          longitude: 73.9220
        },
        {
          name: "Dudhsagar Falls",
          type: "Waterfall",
          latitude: 15.3144,
          longitude: 74.3143
        },
        {
          name: "Old Goa Churches",
          type: "Heritage Site",
          latitude: 15.5008,
          longitude: 73.9110
        },
        {
          name: "Arambol Beach",
          type: "Beach",
          latitude: 15.6868,
          longitude: 73.7045
        },
        {
          name: "Tito's Lane",
          type: "Entertainment Area",
          latitude: 15.5550,
          longitude: 73.7510
        }
      ]
    }
  ];

  const normalizedDestination = String(destinationName).toLowerCase();

  let destination = destinations.find(item =>
    item.aliases.some(alias => normalizedDestination.includes(alias))
  );

  if (!destination) {
    destination = destinations.find(item =>
      calculateDistance(
        latitude,
        longitude,
        item.latitude,
        item.longitude
      ) <= 25
    );
  }

  if (!destination) {
    return [];
  }

  let originLat = latitude;
  let originLon = longitude;

  const distanceFromCentre = calculateDistance(
    latitude,
    longitude,
    destination.latitude,
    destination.longitude
  );

  if (distanceFromCentre > 100) {
    originLat = destination.latitude;
    originLon = destination.longitude;
  }

  return destination.places
    .map(place => ({
      name: place.name,
      type: place.type,
      distance: calculateDistance(
        originLat,
        originLon,
        place.latitude,
        place.longitude
      ),
      source: "Built-in destination guide"
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 10);
}

async function getNearbyPlaces(latitude, longitude, destinationName = "") {
  const fallback = getBuiltInAttractions(
    latitude,
    longitude,
    destinationName
  );

  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
  ];

  const query = `
    [out:json][timeout:5];
    (
      nwr(around:7000,${latitude},${longitude})["tourism"~"^(attraction|museum|viewpoint|zoo|theme_park|gallery|aquarium)$"];
      nwr(around:7000,${latitude},${longitude})["historic"];
      nwr(around:7000,${latitude},${longitude})["leisure"="park"];
      nwr(around:7000,${latitude},${longitude})["natural"~"^(waterfall|peak|beach)$"];
      nwr(around:7000,${latitude},${longitude})["amenity"="place_of_worship"];
    );
    out center tags;
  `;

  for (const endpoint of endpoints) {
    try {
      console.log("Searching live attractions using:", endpoint);

      const response = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "PackSmartTravelPlanner/1.0"
          },
          body: "data=" + encodeURIComponent(query)
        },
        6000
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      const places = (data.elements || [])
        .map(element => {
          const tags = element.tags || {};
          const lat = element.lat ?? element.center?.lat;
          const lon = element.lon ?? element.center?.lon;

          if (!tags.name || lat == null || lon == null) {
            return null;
          }

          const type =
            tags.tourism ||
            tags.historic ||
            tags.leisure ||
            tags.natural ||
            tags.amenity ||
            "attraction";

          return {
            name: tags.name,
            type: formatPlaceType(type),
            distance: calculateDistance(
              latitude,
              longitude,
              Number(lat),
              Number(lon)
            ),
            source: "OpenStreetMap"
          };
        })
        .filter(Boolean);

      const uniquePlaces = [
        ...new Map(
          places.map(place => [place.name.toLowerCase(), place])
        ).values()
      ];

      if (uniquePlaces.length) {
        console.log("Live attractions found:", uniquePlaces.length);

        return uniquePlaces
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 10);
      }
    } catch (error) {
      console.log("Live attraction request failed:", error.message);
    }
  }

  try {
    const wikiUrl = new URL("https://en.wikipedia.org/w/api.php");
    wikiUrl.searchParams.set("action", "query");
    wikiUrl.searchParams.set("list", "geosearch");
    wikiUrl.searchParams.set("gscoord", `${latitude}|${longitude}`);
    wikiUrl.searchParams.set("gsradius", "10000");
    wikiUrl.searchParams.set("gslimit", "10");
    wikiUrl.searchParams.set("format", "json");
    wikiUrl.searchParams.set("origin", "*");

    const wikiResponse = await fetchWithTimeout(
      wikiUrl.toString(),
      {
        headers: {
          "User-Agent": "PackSmartTravelPlanner/1.0 (educational project)"
        }
      },
      5000
    );

    if (wikiResponse.ok) {
      const wikiData = await wikiResponse.json();

      const wikiPlaces = (wikiData.query?.geosearch || [])
        .map(item => ({
          name: item.title,
          type: "Nearby place (Wikipedia)",
          distance: Number((item.dist / 1000).toFixed(1)),
          source: "Wikipedia geosearch"
        }))
        .filter(item => item.name);

      if (wikiPlaces.length) {
        console.log(
          "Wikimedia backup attractions found:",
          wikiPlaces.length
        );

        return wikiPlaces.slice(0, 10);
      }
    }
  } catch (error) {
    console.log(
      "Wikimedia nearby-place lookup failed:",
      error.message
    );
  }

  console.log("Using built-in attraction fallback:", fallback.length);

  if (fallback.length) {
    return fallback;
  }

  return [
    {
      name: `Historic landmarks in ${destinationName || "your destination"}`,
      type: "General suggestion",
      distance: null,
      source: "General fallback suggestion"
    },
    {
      name: `Museums and cultural places in ${destinationName || "your destination"}`,
      type: "General suggestion",
      distance: null,
      source: "General fallback suggestion"
    },
    {
      name: `Popular parks and gardens in ${destinationName || "your destination"}`,
      type: "General suggestion",
      distance: null,
      source: "General fallback suggestion"
    },
    {
      name: `Scenic spots around ${destinationName || "your destination"}`,
      type: "General suggestion",
      distance: null,
      source: "General fallback suggestion"
    },
    {
      name: `Local markets and famous streets in ${destinationName || "your destination"}`,
      type: "General suggestion",
      distance: null,
      source: "General fallback suggestion"
    }
  ];
}

function getTripDuration(startDate, endDate) {
  if (!startDate || !endDate) return 1;

  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end < start
  ) {
    return 1;
  }

  return Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / 86400000) + 1
  );
}

function generatePackingList(trip) {
  const items = new Set([
    "Clothing appropriate for the trip",
    "Comfortable footwear",
    "Toothbrush and toothpaste",
    "Personal toiletries",
    "Phone and charger",
    "Identification documents",
    "Wallet and payment cards",
    "Reusable water bottle",
    "Personal medicines",
    "Small day bag"
  ]);

  const weather = String(trip.weather || "").toLowerCase();
  const tripType = String(trip.tripType || "").toLowerCase();
  const travellerType = String(trip.travellerType || "").toLowerCase();

  if (trip.duration >= 4) {
    items.add("Extra clothing");
    items.add("Laundry bag");
  }

  if (trip.duration >= 7) {
    items.add("Extra toiletries");
  }

  if (weather.includes("rain")) {
    items.add("Umbrella or raincoat");
    items.add("Waterproof bag");
    items.add("Quick-dry clothing");
  }

  if (weather.includes("cold")) {
    items.add("Warm jacket");
    items.add("Warm socks");
  }

  if (weather.includes("hot")) {
    items.add("Sunscreen");
    items.add("Sunglasses");
    items.add("Cap or hat");
    items.add("Lightweight clothing");
  }

  if (tripType.includes("adventure")) {
    items.add("Outdoor shoes");
    items.add("First-aid kit");
    items.add("Torch");
    items.add("Power bank");
  }

  if (tripType.includes("business")) {
    items.add("Formal clothing");
    items.add("Laptop and charger");
    items.add("Notebook and pen");
    items.add("Work documents");
  }

  if (tripType.includes("family")) {
    items.add("Family travel documents");
    items.add("Snacks for the journey");
  }

  if (travellerType.includes("couple")) {
    items.add("Booking confirmations");
  }

  if (travellerType.includes("friends")) {
    items.add("Group booking details");
  }

  for (const activity of trip.activities) {
    const name = String(activity).toLowerCase();

    if (name.includes("beach")) {
      items.add("Swimwear");
      items.add("Beach towel");
      items.add("Flip-flops");
      items.add("Waterproof phone pouch");
    }

    if (name.includes("hik")) {
      items.add("Hiking shoes");
      items.add("Energy snacks");
      items.add("Sun protection");
    }

    if (name.includes("sight")) {
      items.add("Camera");
      items.add("Comfortable walking shoes");
    }

    if (name.includes("business")) {
      items.add("Laptop and charger");
      items.add("Formal clothing");
    }
  }

  return Array.from(items);
}

function generateSmartTip(trip, weather) {
  if (
    weather.available &&
    /rain|drizzle|thunderstorm/i.test(weather.description)
  ) {
    return "Check the weather before leaving and keep a raincoat or umbrella handy.";
  }

  if (weather.available && weather.temperature >= 32) {
    return "The weather is hot. Carry sunscreen, drink water, and plan breaks in shaded areas.";
  }

  if (weather.available && weather.temperature <= 10) {
    return "Cool conditions are expected. Pack warm layers for mornings and evenings.";
  }

  if (trip.tripType.toLowerCase().includes("adventure")) {
    return "Keep essential medicines, a first-aid kit, and an offline map accessible.";
  }

  if (trip.tripType.toLowerCase().includes("business")) {
    return "Keep your identification, bookings, work documents, and chargers together.";
  }

  return "Keep essential documents and medicines in your hand luggage, and check your bookings before departure.";
}

function generateBudget(trip) {
  const rates = {
    Budget: 1500,
    Moderate: 3500,
    Luxury: 8000
  };

  const rate = rates[trip.budget] || rates.Moderate;
  const travellers = Math.max(1, Number(trip.travellers || 1));
  const total = Math.round(rate * trip.duration * travellers);

  return {
    total,
    level: rates[trip.budget] ? trip.budget : "Moderate",
    travellers,
    currency: "INR",
    accommodation: Math.round(total * 0.4),
    food: Math.round(total * 0.3),
    activities: Math.round(total * 0.2),
    transport: Math.round(total * 0.1),
    note: "Estimated costs only. Actual expenses vary by destination and bookings."
  };
}

function generateItinerary(trip, places) {
  const itinerary = [];
  const days = Math.min(trip.duration, 14);

  for (let day = 1; day <= days; day++) {
    let plan;

    if (places.length) {
      const first = (day - 1) * 2;
      const firstPlace = places[first % places.length].name;

      if (places.length > 1) {
        const secondPlace = places[(first + 1) % places.length].name;

        plan = `Morning: Visit ${firstPlace}. Afternoon: Explore ${secondPlace}. Evening: Enjoy local food and relax.`;
      } else {
        plan = `Visit ${firstPlace}, explore the local area, and enjoy local food in the evening.`;
      }
    } else {
      plan = "Explore local attractions, discover nearby markets, and enjoy the local cuisine.";
    }

    itinerary.push({
      day,
      title: `Day ${day}`,
      plan
    });
  }

  return itinerary;
}

async function generateTrip(body) {
  const destination = String(body.destination || "").trim();

  if (!destination) {
    throw new Error("Please enter a destination.");
  }

  const startDate = body.startDate || body.start || "";
  const endDate = body.endDate || body.end || "";

  const activities = Array.isArray(body.activities)
    ? body.activities
    : body.activities
      ? [body.activities]
      : [];

  const tripBase = {
    destination,
    tripType: body.tripType || "Family",
    travellerType: body.travellerType || "Solo",
    startDate,
    endDate,
    duration: getTripDuration(startDate, endDate),
    activities,
    weather: body.weather || "Moderate",
    budget: body.budget || "Moderate",
    travellers: Number(body.travellers || body.travelers || 1)
  };

  console.log("Generating trip for:", destination);

  const location = await findDestination(destination);

  const [weatherData, places] = await Promise.all([
    getWeather(location.latitude, location.longitude),
    getNearbyPlaces(
      location.latitude,
      location.longitude,
      destination
    )
  ]);

  const packingList = generatePackingList(tripBase);
  const budgetEstimate = generateBudget(tripBase);
  const smartTip = generateSmartTip(tripBase, weatherData);
  const itinerary = generateItinerary(tripBase, places);

  const trip = {
    ...tripBase,
    location: location.name,
    latitude: location.latitude,
    longitude: location.longitude,
    weatherData,
    budgetEstimate,
    packingList,
    places,
    attractions: places,
    nearbyAttractions: places,
    itinerary,
    smartTip,
    alert: weatherData.available
      ? `Current conditions: ${weatherData.description}, ${Math.round(weatherData.temperature)}°C.`
      : "Live weather is temporarily unavailable. Check the forecast before departure.",
    createdAt: new Date().toISOString()
  };

  console.log("Trip generated successfully for:", destination);
  console.log("Nearby attractions included:", places.length);

  return trip;
}

app.get("/api/test", (req, res) => {
  res.json({
    message: "PackSmart backend is working!",
    databaseConnected: Boolean(tripsCollection)
  });
});

app.post("/api/trips", async (req, res) => {
  try {
    const trip = await generateTrip(req.body || {});
    res.json({
      success: true,
      trip
    });
  } catch (error) {
    console.error("Trip generation error:", error);

    res.status(400).json({
      success: false,
      message: error.message || "Unable to generate trip.",
      error: error.message || "Unable to generate trip."
    });
  }
});

app.post("/api/trips/save", async (req, res) => {
  try {
    if (!tripsCollection) {
      return res.status(503).json({
        message: "Database is not connected."
      });
    }

    const trip = req.body?.trip || req.body;

    if (!trip || !trip.destination) {
      return res.status(400).json({
        message: "A generated trip with a destination is required."
      });
    }

    const savedTrip = {
      ...trip,
      savedAt: new Date()
    };

    delete savedTrip._id;
    delete savedTrip.success;
    delete savedTrip.trip;

    const result = await tripsCollection.insertOne(savedTrip);

    res.status(201).json({
      success: true,
      message: "Trip saved successfully!",
      tripId: result.insertedId.toString(),
      trip: {
        ...savedTrip,
        _id: result.insertedId
      }
    });
  } catch (error) {
    console.error("Save trip error:", error);

    res.status(500).json({
      message: "Unable to save the trip."
    });
  }
});

app.get("/api/trips/saved", async (req, res) => {
  try {
    if (!tripsCollection) {
      return res.status(503).json({
        message: "Database is not connected.",
        trips: []
      });
    }

    const trips = await tripsCollection
      .find({})
      .sort({ savedAt: -1 })
      .limit(100)
      .toArray();

    res.json({ trips });
  } catch (error) {
    console.error("Fetch saved trips error:", error);

    res.status(500).json({
      message: "Unable to retrieve saved trips.",
      trips: []
    });
  }
});

app.get("/api/trips/saved/:id", async (req, res) => {
  try {
    if (!tripsCollection) {
      return res.status(503).json({
        message: "Database is not connected."
      });
    }

    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        message: "Invalid trip ID."
      });
    }

    const trip = await tripsCollection.findOne({
      _id: new ObjectId(req.params.id)
    });

    if (!trip) {
      return res.status(404).json({
        message: "Saved trip not found."
      });
    }

    res.json({ trip });
  } catch (error) {
    console.error("Fetch trip error:", error);

    res.status(500).json({
      message: "Unable to retrieve this trip."
    });
  }
});

app.delete("/api/trips/saved/:id", async (req, res) => {
  try {
    if (!tripsCollection) {
      return res.status(503).json({
        message: "Database is not connected."
      });
    }

    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        message: "Invalid trip ID."
      });
    }

    const result = await tripsCollection.deleteOne({
      _id: new ObjectId(req.params.id)
    });

    if (!result.deletedCount) {
      return res.status(404).json({
        message: "Saved trip not found."
      });
    }

    res.json({
      success: true,
      message: "Trip deleted successfully."
    });
  } catch (error) {
    console.error("Delete trip error:", error);

    res.status(500).json({
      message: "Unable to delete the trip."
    });
  }
});

async function startServer() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is missing from your .env file.");
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();

    db = client.db(DB_NAME);
    tripsCollection = db.collection("trips");

    console.log("MongoDB connected successfully!");
    console.log("Database:", DB_NAME);

    app.listen(PORT, () => {
      console.log(`PackSmart server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Unable to connect to MongoDB:", error.message);
    process.exit(1);
  }
}

startServer();