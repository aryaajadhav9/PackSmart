const form = document.getElementById("tripForm");
const packingList = document.getElementById("packingList");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");

let currentTrip = null;

function scrollToPlanner() {
    const planner = document.getElementById("planner");

    if (planner) {
        planner.scrollIntoView({
            behavior: "smooth"
        });
    }
}

form.addEventListener("submit", async function(event) {
    event.preventDefault();

    const destination = document.getElementById("destination").value.trim();
    const tripType = document.getElementById("tripType").value;
    const travellerType = document.getElementById("travellerType").value;
    const startDate = document.getElementById("startDate").value;
    const endDate = document.getElementById("endDate").value;
    const budget = document.getElementById("budget").value;
    const travellers = Number(document.getElementById("travellers").value);

    const selectedWeather = document.querySelector(
        'input[name="weather"]:checked'
    );

    if (!selectedWeather) {
        alert("Please select the expected weather.");
        return;
    }

    if (!destination) {
        alert("Please enter a destination.");
        return;
    }

    if (!startDate || !endDate) {
        alert("Please select your travel dates.");
        return;
    }

    if (new Date(endDate) < new Date(startDate)) {
        alert("End date cannot be before the start date.");
        return;
    }

    const activities = [];

    document.querySelectorAll(
        ".activity-card input:checked"
    ).forEach(function(item) {
        activities.push(item.value);
    });

    const button = document.querySelector(".generate-btn");

    button.disabled = true;
    button.innerHTML = "⏳ Building your smart trip...";

    try {
        const response = await fetch("/api/trips", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                destination,
                tripType,
                travellerType,
                startDate,
                endDate,
                weather: selectedWeather.value,
                activities,
                budget,
                travellers
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.message || "Unable to generate trip."
            );
        }

        displayTrip(data.trip);

    } catch (error) {
        console.error(error);

        alert(
            error.message ||
            "Something went wrong while creating your trip."
        );

    } finally {
        button.disabled = false;
        button.innerHTML =
            "<span>✨</span> Generate My Smart Trip <span>→</span>";
    }
});

function displayTrip(trip) {

    currentTrip = trip;

    const results = document.getElementById("results");

    if (results) {
        results.scrollIntoView({
            behavior: "smooth"
        });
    }

    document.getElementById("resultTitle").textContent =
        `${trip.destination} is ready to explore`;

    document.getElementById("resultSubtitle").textContent =
        `${trip.tripType} trip • ${trip.travellerType} traveller • ${trip.duration} day(s)`;

    document.getElementById("summaryDestination").textContent =
        trip.destination;

    document.getElementById("summaryTraveller").textContent =
        trip.travellerType;

    document.getElementById("summaryDuration").textContent =
        `${trip.duration} day(s)`;

    document.getElementById("smartTip").textContent =
        trip.smartTip || "Have a safe and enjoyable trip!";

    document.getElementById("smartAlert").innerHTML =
        `💡 <span>${escapeHtml(
            trip.alert || "Travel smart and stay prepared."
        )}</span>`;

    displayWeather(trip.weatherData);
    displayBudget(trip.budgetEstimate);
    displayPackingList(trip.packingList || []);
    displayPlaces(trip.places || []);
    displayItinerary(trip.itinerary || []);
    calculateReadiness();

    localStorage.setItem(
        "packsmartLastTrip",
        JSON.stringify(trip)
    );

    const saveButton = document.getElementById("saveTripBtn");

    if (saveButton) {
        saveButton.disabled = false;
        saveButton.innerHTML = "💾 Save This Trip";
    }
}

function displayWeather(weather) {

    if (!weather) {
        document.getElementById("temperature").textContent = "--°C";
        document.getElementById("weatherDescription").textContent =
            "Weather unavailable";
        document.getElementById("humidity").textContent = "--";
        document.getElementById("wind").textContent = "--";
        document.getElementById("weatherIcon").textContent = "🌤️";
        return;
    }

    document.getElementById("temperature").textContent =
        `${Math.round(weather.temperature)}°C`;

    document.getElementById("weatherDescription").textContent =
        weather.description || "Current weather";

    document.getElementById("humidity").textContent =
        weather.humidity ?? "--";

    document.getElementById("wind").textContent =
        Math.round(weather.wind ?? 0);

    document.getElementById("weatherIcon").textContent =
        weather.icon || "🌤️";
}

function displayBudget(budget) {

    if (!budget) {
        document.getElementById("budgetAmount").textContent = "0";
        document.getElementById("budgetMessage").textContent =
            "Budget estimate unavailable.";
        return;
    }

    document.getElementById("budgetAmount").textContent =
        Number(budget.total || 0).toLocaleString("en-IN");

    document.getElementById("budgetMessage").textContent =
        `${budget.level || "Moderate"} estimate for ${budget.travellers || 1} traveller(s)`;
}

function displayPackingList(items) {

    packingList.innerHTML = "";

    if (!items.length) {
        packingList.innerHTML =
            "<p>No packing items generated.</p>";
        updateProgress();
        return;
    }

    items.forEach(function(item, index) {

        const div = document.createElement("div");

        div.className = "check-item";

        div.innerHTML = `
            <input type="checkbox" id="pack-${index}">
            <label for="pack-${index}">
                ${escapeHtml(item)}
            </label>
        `;

        const checkbox = div.querySelector("input");

        checkbox.addEventListener("change", function() {

            div.classList.toggle(
                "completed",
                checkbox.checked
            );

            calculateReadiness();
        });

        packingList.appendChild(div);
    });

    updateProgress();
}

function updateProgress() {

    const checkboxes = document.querySelectorAll(
        "#packingList input[type='checkbox']"
    );

    const checked = document.querySelectorAll(
        "#packingList input[type='checkbox']:checked"
    );

    if (!checkboxes.length) {
        progressBar.style.width = "0%";
        progressText.textContent = "0%";
        return;
    }

    const percentage = Math.round(
        checked.length / checkboxes.length * 100
    );

    progressBar.style.width = `${percentage}%`;
    progressText.textContent = `${percentage}%`;
}

function calculateReadiness() {

    const checkboxes = document.querySelectorAll(
        "#packingList input[type='checkbox']"
    );

    const checked = document.querySelectorAll(
        "#packingList input[type='checkbox']:checked"
    );

    if (!checkboxes.length) {
        document.getElementById("readinessScore").textContent = "0%";
        return;
    }

    const percentage = Math.round(
        checked.length / checkboxes.length * 100
    );

    document.getElementById("readinessScore").textContent =
        `${percentage}%`;

    if (percentage === 100) {

        document.getElementById("scoreMessage").textContent =
            "You're fully packed. Have a great trip! 🎉";

    } else if (percentage >= 70) {

        document.getElementById("scoreMessage").textContent =
            "Almost ready! Just a few items remain.";

    } else if (percentage >= 40) {

        document.getElementById("scoreMessage").textContent =
            "Good progress. Keep checking your essentials.";

    } else {

        document.getElementById("scoreMessage").textContent =
            "Start checking items to improve your readiness.";
    }

    updateProgress();
}

function displayPlaces(places) {

    const grid = document.getElementById("placesGrid");

    if (!grid) {
        return;
    }

    grid.innerHTML = "";

    document.getElementById("placesCount").textContent =
        `${places.length} places`;

    if (!places.length) {

        grid.innerHTML = `
            <div class="place-card">
                <div class="place-icon">📍</div>
                <h3>No attractions found</h3>
                <p>
                    Try entering a larger city or popular destination.
                </p>
            </div>
        `;

        return;
    }

    places.forEach(function(place) {

        const card = document.createElement("div");

        card.className = "place-card";

        const mapUrl =
            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                place.name
            )}`;

        card.innerHTML = `
            <div class="place-icon">
                ${getPlaceIcon(place.type || "")}
            </div>

            <h3>${escapeHtml(place.name)}</h3>

            <p>
                ${escapeHtml(place.type || "Attraction")}
            </p>

            <div class="place-distance">
                📍 ${place.distance ?? "--"} km away
            </div>

            <div class="place-actions">

                <a
                    href="${mapUrl}"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    View on Maps
                </a>

                <button
                    onclick="savePlace('${escapeAttribute(place.name)}')"
                >
                    ♡ Save
                </button>

            </div>
        `;

        grid.appendChild(card);
    });
}

function getPlaceIcon(type) {

    const value = String(type).toLowerCase();

    if (value.includes("museum")) return "🏛️";
    if (value.includes("park")) return "🌳";
    if (value.includes("beach")) return "🏖️";
    if (value.includes("view")) return "🌄";
    if (value.includes("zoo")) return "🦁";
    if (value.includes("historic")) return "🏰";
    if (value.includes("temple")) return "🛕";
    if (value.includes("church")) return "⛪";
    if (value.includes("fort")) return "🏯";

    return "📍";
}

function savePlace(name) {

    const saved = JSON.parse(
        localStorage.getItem("packsmartSavedPlaces") || "[]"
    );

    if (!saved.includes(name)) {

        saved.push(name);

        localStorage.setItem(
            "packsmartSavedPlaces",
            JSON.stringify(saved)
        );

        alert(`${name} saved to your favourites! ❤️`);

    } else {

        alert(`${name} is already saved.`);
    }
}

function displayItinerary(itinerary) {

    const container = document.getElementById("itinerary");

    if (!container) {
        return;
    }

    container.innerHTML = "";

    if (!itinerary.length) {
        container.innerHTML =
            "<p>No itinerary available.</p>";
        return;
    }

    itinerary.forEach(function(day) {

        const card = document.createElement("div");

        card.className = "day-card";

        card.innerHTML = `
            <div class="day-number">
                DAY ${day.day}
            </div>

            <h3>${escapeHtml(day.title || "Travel Day")}</h3>

            <p>${escapeHtml(day.plan || "Explore and enjoy your destination.")}</p>
        `;

        container.appendChild(card);
    });
}

function escapeHtml(text) {

    return String(text ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function escapeAttribute(text) {

    return String(text ?? "")
        .replaceAll("\\", "\\\\")
        .replaceAll("'", "\\'");
}

const saveTripButton =
    document.getElementById("saveTripBtn");

if (saveTripButton) {

    saveTripButton.addEventListener(
        "click",
        async function() {

            if (!currentTrip) {

                const storedTrip =
                    localStorage.getItem("packsmartLastTrip");

                if (storedTrip) {

                    try {
                        currentTrip = JSON.parse(storedTrip);
                    } catch (error) {
                        currentTrip = null;
                    }
                }
            }

            if (!currentTrip) {
                alert("Generate a trip first.");
                return;
            }

            saveTripButton.disabled = true;
            saveTripButton.innerHTML = "⏳ Saving...";

            try {

                const response = await fetch(
                    "/api/trips/save",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify(currentTrip)
                    }
                );

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(
                        data.message ||
                        "Unable to save trip."
                    );
                }

                currentTrip._id = data.tripId;

                localStorage.setItem(
                    "packsmartLastTrip",
                    JSON.stringify(currentTrip)
                );

                saveTripButton.innerHTML =
                    "✓ Saved to My Trips";

                alert(
                    "Your trip has been saved to MongoDB! 💾🎉"
                );

                loadSavedTrips();

            } catch (error) {

                console.error(error);

                alert(
                    error.message ||
                    "Unable to save your trip. Please try again."
                );

                saveTripButton.innerHTML =
                    "💾 Save This Trip";

            } finally {

                saveTripButton.disabled = false;
            }
        }
    );
}

async function loadSavedTrips() {

    const container =
        document.getElementById("savedTripsContainer");

    if (!container) {
        return;
    }

    container.innerHTML =
        `<div class="saved-loading">⏳ Loading your saved trips...</div>`;

    try {

        const response =
            await fetch("/api/trips/saved");

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.message ||
                "Unable to load saved trips."
            );
        }

        renderSavedTrips(data.trips || []);

    } catch (error) {

        console.error(error);

        container.innerHTML = `
            <div class="saved-empty">
                <div class="saved-empty-icon">⚠️</div>
                <h3>Unable to load saved trips</h3>
                <p>
                    Please make sure the PackSmart server is running.
                </p>
            </div>
        `;
    }
}

function renderSavedTrips(trips) {

    const container =
        document.getElementById("savedTripsContainer");

    if (!container) {
        return;
    }

    if (!trips.length) {

        container.innerHTML = `
            <div class="saved-empty">
                <div class="saved-empty-icon">🧳</div>
                <h3>No saved trips yet</h3>
                <p>
                    Generate a trip and click
                    <strong>Save This Trip</strong>
                    to see it here.
                </p>
            </div>
        `;

        return;
    }

    container.innerHTML = "";

    trips.forEach(function(trip) {

        const card =
            document.createElement("div");

        card.className = "saved-trip-card";

        card.innerHTML = `
            <div class="saved-trip-icon">
                🌍
            </div>

            <div class="saved-trip-content">

                <h3>
                    ${escapeHtml(trip.destination)}
                </h3>

                <p>
                    ${escapeHtml(trip.tripType)}
                    •
                    ${escapeHtml(trip.travellerType)}
                    •
                    ${trip.duration} day(s)
                </p>

                <span class="saved-trip-date">
                    Saved ${formatSavedDate(trip.createdAt)}
                </span>

            </div>

            <div class="saved-trip-actions">

                <button
                    class="view-saved-btn"
                    onclick="viewSavedTrip('${trip._id}')"
                >
                    View
                </button>

                <button
                    class="delete-saved-btn"
                    onclick="deleteSavedTrip('${trip._id}')"
                >
                    Delete
                </button>

            </div>
        `;

        container.appendChild(card);
    });
}

async function viewSavedTrip(id) {

    try {

        const response =
            await fetch(`/api/trips/saved/${id}`);

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.message ||
                "Unable to load trip."
            );
        }

        displayTrip(data.trip);

    } catch (error) {

        console.error(error);

        alert(
            error.message ||
            "Unable to open saved trip."
        );
    }
}

async function deleteSavedTrip(id) {

    const confirmed =
        confirm(
            "Are you sure you want to delete this saved trip?"
        );

    if (!confirmed) {
        return;
    }

    try {

        const response =
            await fetch(`/api/trips/saved/${id}`, {
                method: "DELETE"
            });

        const data =
            await response.json();

        if (!response.ok) {
            throw new Error(
                data.message ||
                "Unable to delete trip."
            );
        }

        alert("Trip deleted successfully! 🗑️");

        loadSavedTrips();

    } catch (error) {

        console.error(error);

        alert(
            error.message ||
            "Unable to delete the trip."
        );
    }
}

function formatSavedDate(dateValue) {

    if (!dateValue) {
        return "recently";
    }

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return "recently";
    }

    return date.toLocaleDateString(
        "en-IN",
        {
            day: "numeric",
            month: "short",
            year: "numeric"
        }
    );
}

window.addEventListener("load", function() {

    const savedTrip =
        localStorage.getItem("packsmartLastTrip");

    if (savedTrip) {

        try {

            currentTrip = JSON.parse(savedTrip);

            const subtitle =
                document.getElementById("resultSubtitle");

            if (subtitle) {
                subtitle.textContent =
                    "Your previously generated PackSmart trip is available.";
            }

        } catch (error) {

            localStorage.removeItem(
                "packsmartLastTrip"
            );
        }
    }

    loadSavedTrips();
});
