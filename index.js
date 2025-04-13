import { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

// Set up directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ]
});

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const TWITTER_API_URL = process.env.AXIOM_TWITTER_API_URL;
const TWITTER_SINGLE_TWEET_API_BASE = "api-neo.bullx.io/v2/tweet/";
const POLLING_INTERVAL = parseInt(process.env.POLLING_INTERVAL) || 300; // Default to 300ms for near real-time updates
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// Store the last processed tweet ID and timestamp to avoid duplicates
let lastProcessedIds = {};
let lastFetchTimestamp = null;
const PROCESSED_IDS_FILE = path.join(__dirname, 'processed_ids.json');
const STATE_FILE = path.join(__dirname, 'bot_state.json');

// Create a cache directory for temporarily storing media
const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR);
}

// Load previously processed tweet IDs and state if they exist
try {
  if (fs.existsSync(PROCESSED_IDS_FILE)) {
    const data = fs.readFileSync(PROCESSED_IDS_FILE, 'utf8');
    lastProcessedIds = JSON.parse(data);
    console.log(`Loaded ${Object.keys(lastProcessedIds).length} previously processed tweet IDs`);
  }
  
  if (fs.existsSync(STATE_FILE)) {
    const stateData = fs.readFileSync(STATE_FILE, 'utf8');
    const state = JSON.parse(stateData);
    lastFetchTimestamp = state.lastFetchTimestamp || null;
    console.log(`Loaded last fetch timestamp: ${new Date(lastFetchTimestamp).toISOString()}`);
  }
} catch (error) {
  console.error('Error loading state files:', error);
  // Continue with empty state if files don't exist or are invalid
}

// Save state
function saveState() {
  try {
    // Save processed IDs
    fs.writeFileSync(PROCESSED_IDS_FILE, JSON.stringify(lastProcessedIds, null, 2));
    
    // Save fetch timestamp
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      lastFetchTimestamp: lastFetchTimestamp
    }, null, 2));
  } catch (error) {
    console.error('Error saving state:', error);
  }
}

// Helper function for retry logic
async function withRetry(fn, maxRetries = MAX_RETRIES, delay = RETRY_DELAY) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt}/${maxRetries} failed:`, error.message);
      
      if (attempt < maxRetries) {
        console.log(`Retrying in ${delay/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// Function to fetch tweets from Twitter API
async function fetchTweets() {
  return withRetry(async () => {
    console.log('Fetching tweets from Twitter API...');
    
    const response = await axios.get(TWITTER_API_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://api-neo.bullx.io/',
        'Origin': 'https://api-neo.bullx.io',
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    });

    if (response.status === 200) {
      // The new API returns tweets in a data array
      return response.data?.data || [];
    } else {
      console.error('Unexpected status code:', response.status);
      throw new Error(`API returned status code ${response.status}`);
    }
  });
}

// New function to fetch detailed tweet data for a single tweet ID
async function fetchSingleTweet(tweetId) {
  return withRetry(async () => {
    console.log(`Fetching detailed data for tweet ID: ${tweetId}`);
    
    const url = `https://${TWITTER_SINGLE_TWEET_API_BASE}${tweetId}`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://api-neo.bullx.io/',
        'Origin': 'https://api-neo.bullx.io',
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    });

    if (response.status === 200) {
      return response.data?.data;
    } else {
      console.error(`Failed to fetch tweet ${tweetId}, status: ${response.status}`);
      throw new Error(`API returned status code ${response.status}`);
    }
  });
}

// Function to download media file
async function downloadMedia(url, filename) {
  return withRetry(async () => {
    console.log(`Downloading media from ${url}`);
    
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
      timeout: 15000 // 15 second timeout for media download
    });
    
    const filePath = path.join(CACHE_DIR, filename);
    fs.writeFileSync(filePath, response.data);
    console.log(`Media saved to ${filePath}`);
    return filePath;
  });
}

// Function to process tweets and send to Discord
async function processTweets() {
  try {
    const tweets = await fetchTweets();
    
    if (!Array.isArray(tweets)) {
      console.error('Unexpected response format:', typeof tweets);
      console.error('Response preview:', JSON.stringify(tweets).substring(0, 200));
      return;
    }
    
    // Get the current timestamp
    const currentFetchTime = Date.now();
    
    // First run handling - if this is the first run, we don't want to send all historical tweets
    if (lastFetchTimestamp === null) {
      console.log('First run detected - marking all tweets as processed without sending them');
      for (const tweet of tweets) {
        lastProcessedIds[tweet.id] = true;
      }
      lastFetchTimestamp = currentFetchTime;
      saveState();
      console.log('All existing tweets marked as processed. Will only send new tweets from now on.');
      return;
    }
    
    // Get the Discord channel
    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel) {
      console.error('Could not find Discord channel with ID:', DISCORD_CHANNEL_ID);
      return;
    }
    
    // Sort tweets newest first to prioritize most recent
    const sortedTweets = [...tweets].sort((a, b) => {
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      return timeB - timeA; // Descending order (newest first)
    });
    
    // Time threshold - only process tweets created within the last minute
    // This helps filter out older tweets that keep appearing in the API response
    const ONE_MINUTE = 60 * 1000;
    const currentTime = Date.now();
    const recentTweets = sortedTweets.filter(tweet => {
      const tweetTime = new Date(tweet.created_at).getTime();
      return (currentTime - tweetTime) <= ONE_MINUTE; 
    });
    
    // Fast return if no recent tweets
    if (recentTweets.length === 0) {
      // Quick update timestamp without saving state (for performance)
      lastFetchTimestamp = currentFetchTime;
      return;
    }
    
    console.log(`Found ${recentTweets.length} recent tweets to process`);
    
    // Process each tweet immediately if it's new
    for (const tweet of recentTweets) {
      // Skip if we've already processed this tweet
      if (lastProcessedIds[tweet.id]) {
        continue;
      }
      
      // Mark as processed immediately to prevent duplicates
      lastProcessedIds[tweet.id] = true;
      
      try {
        // Get user information - handling BullX API format
        const user = tweet.user;
        if (!user) {
          console.log('User data missing, skipping:', tweet.id);
          continue;
        }
        
        // Extract username properly (use username if available, otherwise screen_name)
        const username = user.username || user.screen_name || 'unknown';
        const authorName = user.name || username;
        
        console.log(`New tweet detected: ${tweet.id} from @${username}`);
        
        const tweetUrl = `https://twitter.com/${username}/status/${tweet.id}`;
        const tweetText = tweet.text || '';
        
        // Determine tweet type (normal tweet, retweet, reply)
        const tweetType = tweet.referenced_tweets?.find(rt => rt.type === 'retweeted') 
          ? 'retweet' 
          : tweet.in_reply_to_user_id 
            ? 'reply' 
            : 'tweet';
            
        // Get user's profile image URL (try different possible paths)
        const avatarUrl = user.profile_image_url_https || user.profile_image_url || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';
        
        // Create embed
        const embed = new EmbedBuilder()
          .setColor('#1DA1F2')
          .setAuthor({
            name: `${authorName} (@${username})`,
            iconURL: avatarUrl,
            url: `https://twitter.com/${username}`
          })
          .setURL(tweetUrl);
        
        if (tweetText && tweetText.trim() !== '') {
          embed.setDescription(tweetText);
        } else {
          if (tweetType === 'retweet') {
            embed.setDescription('Retweeted');
          } else if (tweet.attachments?.media_keys?.length > 0) {
            embed.setDescription('Shared media');
          } else {
            embed.setDescription('Posted a tweet');
          }
        }
        
        embed.setTimestamp(new Date(tweet.created_at || Date.now()));
        
        // Add a field with the tweet link for easy access
        embed.addFields({
          name: 'Tweet Link',
          value: `[View original tweet](${tweetUrl})`
        });
        
        embed.setFooter({
          text: `${tweetType.charAt(0).toUpperCase() + tweetType.slice(1)} • via Twitter Feed`,
          iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
        });
        
        // Variables to track media
        let hasFoundImage = false;
        let hasFoundVideo = false;
        let videoPath = null;
        let videoFilename = null;
        
        // NEW: Try to fetch detailed tweet data to get better media 
        try {
          const detailedTweet = await fetchSingleTweet(tweet.id);
          console.log(`Got detailed tweet data for ${tweet.id}`);
          
          // Check for video first (priority over images)
          if (detailedTweet) {
            // Case 1: Handle direct video object in the detailed tweet data
            if (detailedTweet.video && !hasFoundVideo) {
              const videoVariants = detailedTweet.video.variants;
              if (videoVariants && videoVariants.length > 0) {
                // Find mp4 variant with highest quality
                const mp4Variant = videoVariants.find(v => v.type === 'video/mp4' || v.src?.endsWith('.mp4'));
                if (mp4Variant) {
                  const videoUrl = mp4Variant.src || mp4Variant.url;
                  console.log('Found video URL in detailed tweet:', videoUrl);
                  
                  videoFilename = `video_${tweet.id}.mp4`;
                  videoPath = await downloadMedia(videoUrl, videoFilename);
                  
                  if (videoPath) {
                    hasFoundVideo = true;
                    
                    // Update footer to indicate there's a video
                    const currentFooter = embed.data.footer.text;
                    embed.setFooter({
                      text: `${currentFooter} • Video will follow`,
                      iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
                    });
                  }
                }
              }
            }
            
            // Case 2: Check for videos in parent tweet (for replies)
            if (!hasFoundVideo && detailedTweet.parent && detailedTweet.parent.video) {
              const parentVideo = detailedTweet.parent.video;
              if (parentVideo.variants && parentVideo.variants.length > 0) {
                const mp4Variant = parentVideo.variants.find(v => v.type === 'video/mp4' || v.src?.endsWith('.mp4'));
                if (mp4Variant) {
                  const videoUrl = mp4Variant.src || mp4Variant.url;
                  console.log('Found video URL in parent tweet:', videoUrl);
                  
                  videoFilename = `video_parent_${tweet.id}.mp4`;
                  videoPath = await downloadMedia(videoUrl, videoFilename);
                  
                  if (videoPath) {
                    hasFoundVideo = true;
                    
                    // Update footer to indicate there's a video from referenced tweet
                    const currentFooter = embed.data.footer.text;
                    embed.setFooter({
                      text: `${currentFooter} • Video from referenced tweet will follow`,
                      iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
                    });
                  }
                }
              }
            }
            
            // Case 3: Check for videos in mediaDetails
            if (!hasFoundVideo && detailedTweet.mediaDetails && detailedTweet.mediaDetails.length > 0) {
              for (const media of detailedTweet.mediaDetails) {
                if ((media.type === 'video' || media.type === 'animated_gif') && media.video_info?.variants) {
                  // Get best mp4 variant
                  const mp4Variants = media.video_info.variants
                    .filter(variant => variant.content_type === 'video/mp4')
                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                  
                  if (mp4Variants.length > 0) {
                    const videoUrl = mp4Variants[0].url;
                    console.log('Found video URL in mediaDetails:', videoUrl);
                    
                    videoFilename = `video_${tweet.id}.mp4`;
                    videoPath = await downloadMedia(videoUrl, videoFilename);
                    
                    if (videoPath) {
                      hasFoundVideo = true;
                      
                      // Update footer to indicate there's a video
                      const currentFooter = embed.data.footer.text;
                      embed.setFooter({
                        text: `${currentFooter} • Video will follow`,
                        iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
                      });
                      
                      break; // Found a video, no need to check more
                    }
                  }
                }
              }
            }
            
            // Only look for photos if no video was found
            if (!hasFoundVideo) {
              if (detailedTweet.photos && detailedTweet.photos.length > 0) {
                // Process photos from detailed tweet data
                for (const photo of detailedTweet.photos) {
                  if (photo.url && photo.url.includes('media/')) {
                    console.log(`Found high quality photo URL: ${photo.url}`);
                    embed.setImage(photo.url);
                    hasFoundImage = true;
                    
                    if (detailedTweet.photos.length > 1) {
                      const currentFooter = embed.data.footer.text;
                      embed.setFooter({
                        text: `${currentFooter} • ${detailedTweet.photos.length} images`,
                        iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
                      });
                    }
                    break; // Use the first photo in the embed
                  }
                }
              } else if (detailedTweet.mediaDetails && detailedTweet.mediaDetails.length > 0) {
                // Process mediaDetails if photos aren't available
                for (const media of detailedTweet.mediaDetails) {
                  if (media.media_url_https && media.type === 'photo') {
                    console.log(`Found media_url_https: ${media.media_url_https}`);
                    embed.setImage(media.media_url_https);
                    hasFoundImage = true;
                    
                    if (detailedTweet.mediaDetails.length > 1) {
                      const currentFooter = embed.data.footer.text;
                      embed.setFooter({
                        text: `${currentFooter} • ${detailedTweet.mediaDetails.length} images`,
                        iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
                      });
                    }
                    break; // Use the first photo in the embed
                  }
                }
              }
            }
          }
        } catch (detailError) {
          console.error(`Error fetching detailed tweet data for ${tweet.id}:`, detailError);
          // Continue with the standard media handling if detailed fetch fails
        }
        
        // If we didn't find media from the detailed API, fall back to original methods
        if (!hasFoundImage && !hasFoundVideo) {
          // First check for videos in extended_entities (most reliable source)
          if (tweet.extended_entities?.media?.length > 0) {
            console.log('Found extended_entities with media');
            
            // Look for videos first (they take priority)
            const videoMedia = tweet.extended_entities.media.find(media => 
              media.type === 'video' || media.type === 'animated_gif'
            );
            
            if (videoMedia && videoMedia.video_info?.variants) {
              try {
                // Get the highest quality MP4 video variant
                const mp4Variants = videoMedia.video_info.variants
                  .filter(variant => variant.content_type === 'video/mp4')
                  .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                
                if (mp4Variants.length > 0) {
                  const videoUrl = mp4Variants[0].url;
                  console.log('Found video URL in extended_entities:', videoUrl);
                  
                  videoFilename = `video_${tweet.id}.mp4`;
                  videoPath = await downloadMedia(videoUrl, videoFilename);
                  
                  if (videoPath) {
                    hasFoundVideo = true;
                    
                    // Update footer to indicate there's a video
                    const currentFooter = embed.data.footer.text;
                    embed.setFooter({
                      text: `${currentFooter} • Video will follow`,
                      iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
                    });
                  }
                }
              } catch (videoError) {
                console.error('Error handling video from extended_entities:', videoError);
              }
            }
            
            // If no video was found, look for images
            if (!hasFoundVideo && !hasFoundImage) {
              const mediaUrl = tweet.extended_entities.media[0].media_url_https || 
                            tweet.extended_entities.media[0].media_url;
              if (mediaUrl) {
                console.log('Found image URL in extended_entities:', mediaUrl);
                embed.setImage(mediaUrl);
                hasFoundImage = true;
                
                if (tweet.extended_entities.media.length > 1) {
                  const currentFooter = embed.data.footer.text;
                  embed.setFooter({
                    text: `${currentFooter} • ${tweet.extended_entities.media.length} images`,
                    iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
                  });
                }
              }
            }
          }
          
          // If we still don't have media, check for media URLs in the tweet entities
          if (!hasFoundImage && !hasFoundVideo && tweet.entities) {
            // Look for media attached directly in entities
            if (tweet.entities.media?.length > 0) {
              const mediaUrl = tweet.entities.media[0].media_url_https || tweet.entities.media[0].media_url;
              if (mediaUrl) {
                console.log('Found direct media URL in entities:', mediaUrl);
                embed.setImage(mediaUrl);
                hasFoundImage = true;
              }
            }
            
            // Look for image URLs in entities.urls that have images property (BullX API specific)
            if (!hasFoundImage && tweet.entities.urls?.length > 0) {
              // First check for URLs with images property (BullX API format)
              const imageUrlsWithData = tweet.entities.urls.filter(url => url.images?.length > 0);
              if (imageUrlsWithData.length > 0) {
                // Get the URL of the first image, using the largest available
                const imageUrl = imageUrlsWithData[0].images[0].url;
                console.log('Found image URL with data:', imageUrl);
                embed.setImage(imageUrl);
                hasFoundImage = true;
                
                if (imageUrlsWithData.length > 1) {
                  const currentFooter = embed.data.footer.text;
                  embed.setFooter({
                    text: `${currentFooter} • ${imageUrlsWithData.length} images`,
                    iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
                  });
                }
              }
              
              // If no images with data were found, fallback to pic.twitter.com links
              if (!hasFoundImage) {
                const mediaUrls = tweet.entities.urls
                  .filter(url => 
                    url.display_url?.includes('pic.twitter.com') || 
                    url.display_url?.includes('pic.x.com') ||
                    url.expanded_url?.includes('/photo/')
                  )
                  .map(url => url.expanded_url);
                
                if (mediaUrls.length > 0) {
                  console.log(`Found ${mediaUrls.length} image URLs in entities.urls:`, mediaUrls[0]);
                  embed.setImage(mediaUrls[0]);
                  hasFoundImage = true;
                  
                  if (mediaUrls.length > 1) {
                    const currentFooter = embed.data.footer.text;
                    embed.setFooter({
                      text: `${currentFooter} • ${mediaUrls.length} images`,
                      iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
                    });
                  }
                }
              }
            }
          }
        }
        
        // Handle direct media attachments
        if (!hasFoundImage && !hasFoundVideo && tweet.attachments) {
          if (tweet.attachments.media_keys?.length > 0) {
            console.log('Found media keys in attachments:', tweet.attachments.media_keys[0]);
            
            // We can't directly access the media, but we can indicate it's there
            const currentFooter = embed.data.footer.text;
            embed.setFooter({
              text: `${currentFooter} • Contains media`,
              iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'
            });
          }
        }
        
        // Handle reply
        if (tweet.in_reply_to_user_id) {
          embed.addFields({
            name: `Replying to a tweet`,
            value: `This is a reply to another user's tweet.`
          });
        }
        
        // First, send the tweet embed without video attachments
        const embedMessage = await channel.send({ embeds: [embed] });
        console.log(`Sent tweet ${tweet.id} to Discord`);
        
        // If we have video, send it as a separate message
        if (hasFoundVideo && videoPath) {
          try {
            // Create a video attachment
            const videoAttachment = new AttachmentBuilder(videoPath, { name: videoFilename });
            
            // Send video as a separate message (as a reply to the embed if possible)
            await channel.send({ files: [videoAttachment] });
            console.log(`Sent video for tweet ${tweet.id} as a separate message`);
            
            // Clean up video file after sending (5 seconds delay)
            setTimeout(() => {
              try {
                if (fs.existsSync(videoPath)) {
                  fs.unlinkSync(videoPath);
                  console.log(`Cleaned up temp file: ${videoPath}`);
                }
              } catch (cleanupError) {
                console.error('Error cleaning up temp file:', cleanupError);
              }
            }, 5000);
          } catch (videoError) {
            console.error('Error sending video as separate message:', videoError);
          }
        }
        
      } catch (error) {
        console.error(`Error processing tweet ${tweet.id}:`, error);
      }
    }
    
    // Only save state occasionally to reduce disk I/O
    if (recentTweets.length > 0) {
      lastFetchTimestamp = currentFetchTime;
      saveState();
    } else {
      // Just update the timestamp without saving
      lastFetchTimestamp = currentFetchTime;
    }
    
  } catch (error) {
    console.error('Error in processTweets function:', error);
  }
}

// Function to validate API configuration
function validateApiConfig() {
  // Since we no longer use Axiom cookies, we just need to validate the API URL
  if (!TWITTER_API_URL) {
    console.error('ERROR: No API URL provided in .env file');
    return false;
  }
  
  if (!TWITTER_API_URL.includes('api-neo.bullx.io')) {
    console.warn('WARNING: The API URL does not appear to be for the BullX API. Please verify it is correct.');
  }
  
  return true;
}

// Function to poll for tweets periodically
async function pollTweets() {
  console.log(`Starting real-time tweet monitoring with ${POLLING_INTERVAL}ms interval...`);
  
  // Process immediately on startup
  await processTweets();
  
  // Set up continuous polling
  setInterval(async () => {
    try {
      await processTweets();
    } catch (error) {
      console.error('Error in polling cycle:', error);
    }
  }, POLLING_INTERVAL);
}

// Main bot startup
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  
  // Validate API configuration before starting
  if (!validateApiConfig()) {
    console.error('Bot shutting down due to invalid API configuration');
    process.exit(1);
  }
  
  // Start polling for tweets
  pollTweets();
});

// Error handling
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

// Login to Discord
console.log('Connecting to Discord...');
client.login(DISCORD_TOKEN).catch(error => {
  console.error('Failed to login to Discord:', error);
  process.exit(1);
});