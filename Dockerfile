# Use Node.js LTS version
FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app source
COPY . .

# Create logs directory
RUN mkdir -p logs

# Expose the WebSocket port
EXPOSE 8080

# Start the application
CMD [ "npm", "start" ]