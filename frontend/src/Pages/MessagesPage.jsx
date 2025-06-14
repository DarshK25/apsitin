import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { Send, Search, MessageSquare, MoreVertical, Paperclip, File, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import ChatOptions from '../components/ChatOptions';
import { getUnreadCounts } from '../api/userService';
import { useLocation, useNavigate } from 'react-router-dom';
import axiosInstance from '../api/axiosConfig';
import { initSocket, getSocket, disconnectSocket } from '../socket/socket';

const SharedPostPreview = ({ post }) => {
    if (!post) return null;
    
    return (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden mb-2 bg-gray-50 dark:bg-gray-800">
            {/* Header with profile pic and username */}
            <div className="p-3 flex items-center">
                {post.author?.profilePicture ? (
                    <img 
                        src={post.author.profilePicture} 
                        alt={post.author.name}
                        className="w-8 h-8 rounded-full object-cover mr-2" 
                    />
                ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-800 dark:bg-gray-700 flex items-center justify-center mr-2">
                        <span className="text-xs text-white font-medium">
                            {post.author?.name?.charAt(0) || "U"}
                        </span>
                    </div>
                )}
                <Link to={`/profile/${post.author?.username}`}>
                    <span className="font-medium text-xs sm:text-sm text-gray-500 dark:text-gray-100">{post.author?.username || post.author?.name || "Unknown"}</span>
                </Link>
            </div>
            
            {/* Post content - show both image and text if image exists */}
            {post.image && (
                <div className="w-full bg-black dark:bg-gray-900 flex items-center justify-center">
                    <img 
                        src={post.image} 
                        alt="Post" 
                        className="w-full h-auto max-h-64 object-contain"
                    />
                </div>
            )}
            
            {/* Always show text content if it exists */}
            {post.content && (
                <div className={`p-4 ${post.image ? 'bg-white dark:bg-gray-800' : 'bg-white-500 dark:bg-gray-800'} text-gray-700 dark:text-gray-100 font-medium text-xs sm:text-sm`}>
                    <p>{post.content}</p>
                </div>
            )}
            
            {/* Footer with stats and link */}
            <div className="p-3 text-xs sm:text-xs text-gray-500 dark:text-gray-400 flex justify-between items-center">
                <div className="flex items-center gap-1">
                    <span>{post.likes?.length || 0} likes</span>
                    <span>•</span>
                    <span>{post.comments?.length || 0} comments</span>
                </div>
            </div>
        </div>
    );
};

const MessagesPage = () => {
    const { user } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [conversations, setConversations] = useState([]);
    const [filteredConversations, setFilteredConversations] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedUser, setSelectedUser] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [showOptions, setShowOptions] = useState(false);
    const [attachedFile, setAttachedFile] = useState(null);
    const [uploadingFile, setUploadingFile] = useState(false);
    const fileInputRef = useRef(null);
    const messagesEndRef = useRef(null);
    const [hasSentMessageRequest, setHasSentMessageRequest] = useState(false);
    const [isMessageRequestPending, setIsMessageRequestPending] = useState(false);
    const [messageRequestStatus, setMessageRequestStatus] = useState(null);
    const [isLoadingStatus, setIsLoadingStatus] = useState(false);
    const [showProfileFallback, setShowProfileFallback] = useState(false);
    const [isMobileView, setIsMobileView] = useState(false);
    const [showChat, setShowChat] = useState(false);

    // Get user ID from URL query parameter and fetch user data if needed
    useEffect(() => {
        const fetchUserAndSetSelected = async () => {
            const params = new URLSearchParams(location.search);
            const userId = params.get('user');
            
            if (userId) {
                // First check if user is in conversations
                const userConversation = conversations.find(conv => conv.user._id === userId);
                if (userConversation) {
                    setSelectedUser(userConversation.user);
                } else {
                    // If not in conversations, fetch user data
                    try {
                        const response = await axiosInstance.get(`/users/${userId}`);
                        if (response.data.success) {
                            setSelectedUser(response.data.data);
                            // Add this user to conversations list
                            setConversations(prev => [{
                                user: response.data.data,
                                lastMessage: null,
                                unreadCount: 0
                            }, ...prev]);
                        }
                    } catch (error) {
                        console.error('Error fetching user:', error);
                        toast.error('Failed to load user details');
                    }
                }
            }
        };

        if (conversations.length > 0) {
            fetchUserAndSetSelected();
        }
    }, [location.search, conversations]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    // Fetch messages when user is selected
    useEffect(() => {
        const fetchMessages = async (isInitialFetch = false) => {
            if (!selectedUser) return;

            try {
                const response = await axiosInstance.get(`/messages/${selectedUser._id}`);
                if (response.data.success) {
                    const messages = response.data.data;
                    setMessages(messages);
                    
                    // Mark messages as read
                    if (messages.length > 0) {
                        await axiosInstance.post(`/messages/${selectedUser._id}/read`);
                    }
                    
                    if (isInitialFetch) {
                        setTimeout(scrollToBottom, 100);
                    }
                }
            } catch (error) {
                console.error('Error fetching messages:', error);
                toast.error('Failed to load messages');
            }
        };

        fetchMessages(true);
        const interval = setInterval(() => fetchMessages(false), 5000);
        return () => clearInterval(interval);
    }, [selectedUser]);

    // Remove the separate scroll effect since it's now handled in fetchMessages
    useEffect(() => {
        if (messages.length > 0) {
            scrollToBottom();
        }
    }, [selectedUser]); // Only scroll when changing conversations

    // Modify the conversations fetching
    useEffect(() => {
        const fetchConversationsAndConnections = async (isInitialFetch = false) => {
            try {
                if (isInitialFetch) {
                    setLoading(true);
                }

                // Get the user ID from URL if present
                const params = new URLSearchParams(location.search);
                const urlUserId = params.get('user');

                const [conversationsResponse, connectionsResponse] = await Promise.all([
                    axiosInstance.get('/messages/conversations'),
                    axiosInstance.get('/connections')
                ]);

                if (conversationsResponse.data.success) {
                    const existingConversations = conversationsResponse.data.data;
                    const connections = connectionsResponse.data;

                    const existingConversationUsers = new Set(
                        existingConversations.map(conv => conv.user._id)
                    );

                    const newConversations = connections
                        .filter(connection => !existingConversationUsers.has(connection._id))
                        .map(connection => ({
                            user: connection,
                            lastMessage: null,
                            unreadCount: 0
                        }));

                    const allConversations = [...existingConversations, ...newConversations];
                    const sortedConversations = allConversations.sort((a, b) => {
                        const timeA = a.lastMessage?.createdAt || 0;
                        const timeB = b.lastMessage?.createdAt || 0;
                        return new Date(timeB) - new Date(timeA);
                    });

                    setConversations(prev => {
                        const hasChanges = JSON.stringify(prev) !== JSON.stringify(sortedConversations);
                        return hasChanges ? sortedConversations : prev;
                    });

                    setFilteredConversations(prev => {
                        const hasChanges = JSON.stringify(prev) !== JSON.stringify(sortedConversations);
                        return hasChanges ? sortedConversations : prev;
                    });

                    // If we have a URL user ID and it's the initial fetch
                    if (urlUserId && isInitialFetch) {
                        // First check in existing conversations
                        const existingUser = sortedConversations.find(conv => conv.user._id === urlUserId)?.user;
                        
                        if (existingUser) {
                            setSelectedUser(existingUser);
                        } else {
                            // If not in conversations, fetch the user data
                            try {
                                const userResponse = await axiosInstance.get(`/users/${urlUserId}`);
                                
                                if (userResponse.data.success) {
                                    const userData = userResponse.data.data;
                                    setSelectedUser(userData);
                                    // Add to conversations list
                                    setConversations(prev => [{
                                        user: userData,
                                        lastMessage: null,
                                        unreadCount: 0
                                    }, ...prev]);
                                }
                            } catch (userError) {
                                console.error('Failed to fetch user:', userError);
                                if (userError.response?.status === 404) {
                                    toast.error("User not found");
                                } else {
                                    toast.error("Failed to load user data");
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error fetching conversations and connections:', error);
                toast.error('Failed to load conversations');
            } finally {
                if (isInitialFetch) {
                    setLoading(false);
                }
            }
        };

        fetchConversationsAndConnections(true);
        const interval = setInterval(() => fetchConversationsAndConnections(false), 10000);
        return () => clearInterval(interval);
    }, [location.search]);

    // Handle search
    useEffect(() => {
        const filtered = conversations.filter(conversation => {
            const searchLower = searchQuery.toLowerCase();
            const nameLower = (conversation.user?.name || '').toLowerCase();
            const usernameLower = (conversation.user?.username || '').toLowerCase();
            const headlineLower = (conversation.user?.headline || '').toLowerCase();
            
            return nameLower.includes(searchLower) || 
                   usernameLower.includes(searchLower) ||
                   headlineLower.includes(searchLower);
        });
        
        setFilteredConversations(filtered);
    }, [searchQuery, conversations]);

    // Check message request status when user is selected
    useEffect(() => {
        const checkMessageRequestStatus = async () => {
            if (!selectedUser) return;

            try {
                setIsLoadingStatus(true);
                const response = await axiosInstance.get(`/messages/request-status/${selectedUser._id}`);
                
                if (response.data.success) {
                    setMessageRequestStatus(response.data.data);
                }
            } catch (error) {
                console.error('Error checking message request status:', error);
                toast.error('Failed to check message status');
            } finally {
                setIsLoadingStatus(false);
            }
        };

        checkMessageRequestStatus();
    }, [selectedUser]);

    useEffect(() => {
        setShowProfileFallback(false);
    }, [selectedUser]);

    // Add window resize handler
    useEffect(() => {
        const handleResize = () => {
            setIsMobileView(window.innerWidth < 768);
        };

        handleResize(); // Initial check
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Modify the setSelectedUser function to handle mobile view
    const handleSelectUser = (user) => {
        setSelectedUser(user);
        if (isMobileView) {
            setShowChat(true);
        }
    };

    // Add back button handler
    const handleBackToList = () => {
        setShowChat(false);
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Check file size (limit to 10MB)
        if (file.size > 10 * 1024 * 1024) {
            toast.error('File size must be less than 10MB');
            return;
        }

        setAttachedFile(file);
    };

    const handleRemoveAttachment = () => {
        setAttachedFile(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if ((!newMessage.trim() && !attachedFile) || !selectedUser) return;

        try {
            setUploadingFile(true);

            let response;
            if (attachedFile) {
                // If there's a file, use the send-file endpoint
            const formData = new FormData();
                formData.append('recipientId', selectedUser._id);
            if (newMessage.trim()) {
                formData.append('content', newMessage.trim());
            }
                formData.append('file', attachedFile);

                response = await axiosInstance.post('/messages/send-file', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            } else {
                // If it's just text, use the send endpoint
                response = await axiosInstance.post('/messages/send', {
                    recipientId: selectedUser._id,
                    content: newMessage.trim()
                });
            }

            if (response.data.success) {
                setMessages([...messages, response.data.data]);
                setNewMessage('');
                setAttachedFile(null);
                if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                }
                scrollToBottom();
            }
        } catch (error) {
            console.error('Error sending message:', error);
            toast.error('Failed to send message');
        } finally {
            setUploadingFile(false);
        }
    };

    const handleAcceptRequest = async (requestId) => {
        try {
            const response = await axiosInstance.post(`/messages/requests/${requestId}/accept`);
            if (response.data.success) {
                toast.success('Message request accepted');
                setMessageRequestStatus(null);
                // Refresh conversations
                await fetchConversationsAndConnections();
            }
        } catch (error) {
            console.error('Error accepting request:', error);
            toast.error('Failed to accept request');
        }
    };

    const handleRejectRequest = async (requestId) => {
        try {
            const response = await axiosInstance.post(`/messages/requests/${requestId}/reject`);
            if (response.data.success) {
                toast.success('Message request rejected');
                setMessageRequestStatus(null);
            }
        } catch (error) {
            console.error('Error rejecting request:', error);
            toast.error('Failed to reject request');
        }
    };

    const handleOptionsClose = () => {
        setShowOptions(false);
    };

    const handleNavigateToProfile = (username) => {
        navigate(`/profile/${username}`);
    };

    const formatFileSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        else return (bytes / 1048576).toFixed(1) + ' MB';
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
                <div className="p-4 rounded-lg flex flex-col items-center space-y-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
                    <p className="text-gray-500 dark:text-gray-400 text-sm">Loading messages...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-gray-50 dark:bg-gray-950">
            <div className="h-full max-w-8xl mx-auto p-2 sm:p-4 pt-16 sm:pt-20">
                <div className="h-[calc(100vh-4rem)] sm:h-[calc(100vh-5rem)] bg-white dark:bg-gray-900 rounded-lg shadow-lg flex">
                    {/* Conversations List */}
                    <div className={`${isMobileView && showChat ? 'hidden' : 'w-full sm:w-1/3'} border-r border-gray-200 dark:border-gray-700 flex flex-col`}>
                        <div className="p-2 sm:p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Search messages..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-8 sm:pl-10 pr-4 py-1.5 sm:py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 border-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
                                />
                                <Search className="absolute left-2 sm:left-3 top-2 h-4 w-4 sm:h-5 sm:w-5 text-gray-400 dark:text-gray-500" />
                            </div>
                        </div>
                        <div className="overflow-y-auto flex-1">
                            {filteredConversations.length === 0 ? (
                                <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                                    {searchQuery ? 'No conversations found' : 'No messages yet'}
                                </div>
                            ) : (
                                filteredConversations.map((conversation) => (
                                    <div
                                        key={conversation.user._id}
                                        onClick={() => handleSelectUser(conversation.user)}
                                        className={`p-2 sm:p-4 border-b border-gray-100 dark:border-gray-700 cursor-pointer ${
                                            selectedUser?._id === conversation.user._id 
                                                ? 'bg-blue-100 dark:bg-blue-900/30' 
                                                : conversation.unreadCount > 0
                                                    ? 'bg-gray-50 dark:bg-gray-800/50'
                                                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                                        }`}
                                    >
                                        <div className="flex items-center space-x-2 sm:space-x-3">
                                            <div className="relative">
                                                {conversation.user.profilePicture ? (
                                                    <img
                                                        src={conversation.user.profilePicture}
                                                        alt={conversation.user.name}
                                                        className="w-8 h-8 sm:w-10 sm:h-10 rounded-full object-cover"
                                                        onError={(e) => {
                                                            e.target.style.display = 'none';
                                                            e.target.parentElement.innerHTML = 
                                                                `<div class="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gray-900 dark:bg-gray-700 flex items-center justify-center">
                                                                    <svg width="16" height="16" sm:width="20" sm:height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                                                                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                                                        <circle cx="12" cy="7" r="4" />
                                                                    </svg>
                                                                </div>`;
                                                        }}
                                                    />
                                                ) : (
                                                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gray-900 dark:bg-gray-700 flex items-center justify-center">
                                                        <svg width="16" height="16" sm:width="20" sm:height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                                                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                                            <circle cx="12" cy="7" r="4" />
                                                        </svg>
                                                    </div>
                                                )}
                                                {conversation.unreadCount > 0 && (
                                                    <div className="absolute bottom-0 right-0 w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-blue-500 border-2 border-white dark:border-gray-800 flex items-center justify-center">
                                                        <span className="text-[10px] sm:text-[11px] text-white font-bold">
                                                            {conversation.unreadCount}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-start">
                                                    <h3 className={`text-sm sm:text-base ${
                                                        conversation.unreadCount > 0
                                                            ? 'text-black dark:text-gray-100 font-bold' 
                                                            : 'text-gray-800 dark:text-gray-100 font-medium'
                                                    }`}>
                                                        {conversation.user.name}
                                                    </h3>
                                                    <span className={`text-[10px] sm:text-xs ${
                                                        conversation.unreadCount > 0
                                                            ? 'text-black dark:text-gray-100 font-semibold' 
                                                            : 'text-gray-500 dark:text-gray-400'
                                                    }`}>
                                                        {conversation.lastMessage && format(new Date(conversation.lastMessage.createdAt), 'MMM d')}
                                                    </span>
                                                </div>
                                                {conversation.lastMessage && (
                                                    <p className={`text-xs sm:text-sm truncate ${
                                                        conversation.unreadCount > 0
                                                            ? 'text-black dark:text-gray-100 font-semibold' 
                                                            : 'text-gray-500 dark:text-gray-400'
                                                    }`}>
                                                        {conversation.lastMessage.metaContent || conversation.lastMessage.content}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Chat Area */}
                    <div className={`${isMobileView && !showChat ? 'hidden' : 'flex-1'} flex flex-col`}>
                        {selectedUser ? (
                            <>
                                {/* Chat Header */}
                                <div 
                                    className="p-2 sm:p-4 border-b border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                                    onClick={() => handleNavigateToProfile(selectedUser.username)}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-2 sm:space-x-3">
                                            {isMobileView && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleBackToList();
                                                    }}
                                                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors mr-1"
                                                >
                                                    <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                                                </button>
                                            )}
                                            {(!selectedUser.profilePicture || showProfileFallback) ? (
                                                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gray-900 dark:bg-gray-700 flex items-center justify-center">
                                                    <svg width="16" height="16" sm:width="20" sm:height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                                                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                                        <circle cx="12" cy="7" r="4" />
                                                    </svg>
                                                </div>
                                            ) : (
                                                <img
                                                    src={selectedUser.profilePicture}
                                                    alt={selectedUser.name}
                                                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-full"
                                                    onError={() => setShowProfileFallback(true)}
                                                />
                                            )}
                                            <div>
                                                <h3 className="text-sm sm:text-base font-medium text-gray-900 dark:text-gray-100">{selectedUser.name}</h3>
                                                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                                                    {selectedUser.headline || 'APSIT Student'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="relative">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setShowOptions(!showOptions);
                                                }}
                                                className="p-1.5 sm:p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
                                            >
                                                <MoreVertical className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600 dark:text-gray-400" />
                                            </button>
                                            {showOptions && (
                                                <ChatOptions
                                                    selectedUser={selectedUser}
                                                    onClose={handleOptionsClose}
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Messages */}
                                <div className="flex-1 overflow-y-auto p-2 sm:p-4">
                                    {messageRequestStatus?.hasRequest && !messageRequestStatus?.isSender ? (
                                        <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg mb-4">
                                            <p className="text-blue-700 dark:text-blue-300 mb-2">
                                                {selectedUser.name} wants to start a conversation with you
                                            </p>
                                            <div className="flex space-x-2">
                                                <button
                                                    onClick={() => handleAcceptRequest(messageRequestStatus.requestId)}
                                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                                >
                                                    Accept
                                                </button>
                                                <button
                                                    onClick={() => handleRejectRequest(messageRequestStatus.requestId)}
                                                    className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
                                                >
                                                    Decline
                                                </button>
                                            </div>
                                        </div>
                                    ) : messageRequestStatus?.hasRequest && messageRequestStatus?.isSender ? (
                                        <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg mb-4">
                                            <p className="text-blue-700 dark:text-blue-300">
                                                Waiting for {selectedUser.name} to accept your message request
                                            </p>
                                        </div>
                                    ) : null}

                                    {messages.map((message) => (
                                        <div
                                            key={message._id}
                                            className={`flex mb-4 ${
                                                message.sender._id === user._id ? 'justify-end' : 'justify-start'
                                            }`}
                                        >
                                            <div
                                                className={`max-w-[80%] rounded-lg p-3 ${
                                                    message.sender._id === user._id
                                                        ? 'bg-gray-800 text-white'
                                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                                                }`}
                                            >
                                                {message.fileUrl && (
                                                    <div className="flex items-center space-x-2 mb-2">
                                                        <File className="w-5 h-5" />
                                                        <a 
                                                            href={message.fileUrl} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            className="underline hover:text-opacity-80"
                                                        >
                                                            {message.fileName} ({formatFileSize(message.fileSize)})
                                                        </a>
                                                    </div>
                                                )}
                                                {message.sharedPost && (
                                                    <SharedPostPreview post={message.sharedPost} />
                                                )}
                                                {message.content && !message.sharedPost && (
                                                    <p className="whitespace-pre-wrap">{message.content}</p>
                                                )}
                                                <p
                                                    className={`text-xs mt-1 ${
                                                        message.sender._id === user._id
                                                            ? 'text-blue-100'
                                                            : 'text-gray-500 dark:text-gray-400'
                                                    }`}
                                                >
                                                    {format(new Date(message.createdAt), 'HH:mm')}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                    <div ref={messagesEndRef} />
                                </div>

                                {/* Message Input */}
                                <form onSubmit={handleSendMessage} className="p-2 sm:p-4 border-t border-gray-200 dark:border-gray-700">
                                    {attachedFile && (
                                        <div className="mb-2 p-1.5 sm:p-2 bg-gray-50 dark:bg-gray-800 rounded-lg flex items-center justify-between">
                                            <div className="flex items-center space-x-2">
                                                <File className="w-3 h-3 sm:w-4 sm:h-4 text-gray-500 dark:text-gray-400" />
                                                <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-300">
                                                    {attachedFile.name} ({formatFileSize(attachedFile.size)})
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleRemoveAttachment}
                                                className="text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    )}
                                    <div className="flex space-x-2">
                                        <input
                                            type="text"
                                            value={newMessage}
                                            onChange={(e) => setNewMessage(e.target.value)}
                                            placeholder={
                                                messageRequestStatus?.hasRequest && !messageRequestStatus?.canMessage
                                                    ? "Waiting for message request response..."
                                                    : "Type a message..."
                                            }
                                            className="flex-1 px-3 sm:px-4 py-1.5 sm:py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                            disabled={uploadingFile || (messageRequestStatus?.hasRequest && !messageRequestStatus?.canMessage)}
                                        />
                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            onChange={handleFileSelect}
                                            className="hidden"
                                            accept="*/*"
                                            disabled={messageRequestStatus?.hasRequest && !messageRequestStatus?.canMessage}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => fileInputRef.current?.click()}
                                            className={`p-1.5 sm:p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors ${
                                                uploadingFile || (messageRequestStatus?.hasRequest && !messageRequestStatus?.canMessage) ? 'opacity-50 cursor-not-allowed' : ''
                                            }`}
                                            disabled={uploadingFile || (messageRequestStatus?.hasRequest && !messageRequestStatus?.canMessage)}
                                        >
                                            <Paperclip size={18} className="sm:w-5 sm:h-5" />
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={(!newMessage.trim() && !attachedFile) || uploadingFile || (messageRequestStatus?.hasRequest && !messageRequestStatus?.canMessage)}
                                            className="p-1.5 sm:p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                                        >
                                            {uploadingFile ? (
                                                <>
                                                    <div className="w-3 h-3 sm:w-4 sm:h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                    <span className="text-xs sm:text-sm">Sending...</span>
                                                </>
                                            ) : (
                                                <Send size={18} className="sm:w-5 sm:h-5" />
                                            )}
                                        </button>
                                    </div>
                                </form>
                            </>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400 p-4 sm:p-8">
                                <div className="mb-4">
                                    <MessageSquare size={36} className="mx-auto text-gray-400 dark:text-gray-500 sm:w-12 sm:h-12" />
                                </div>
                                <h2 className="text-lg sm:text-xl font-medium mb-2 text-gray-900 dark:text-gray-100">Your Messages</h2>
                                <p className="text-xs sm:text-sm max-w-md">
                                    Send private messages to your connections. Start a conversation by selecting a user from the left or searching for someone specific.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MessagesPage; 