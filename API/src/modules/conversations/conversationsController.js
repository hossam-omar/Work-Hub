
import conversation from "../../../DB/models/conversation_model.js";

const conversationClientProjection = Object.freeze({
    _id: 1,
    name: 1,
    image_url: 1,
    coverImage_url: 1,
    country: 1,
});

const toPlainRecord = (record) => record?._doc ?? record;

const toConversationClient = (clientRecord) => {
    const client = toPlainRecord(clientRecord);
    if (!client) return client;

    return {
        _id: client._id,
        name: client.name,
        image_url: client.image_url,
        coverImage_url: client.coverImage_url,
        country: client.country,
    };
};

const toConversationResponse = (conversationRecord) => {
    const conversationData = toPlainRecord(conversationRecord);

    return {
        ...conversationData,
        client: toConversationClient(conversationData.client),
    };
};

// Get All Conversations
export const getAllConversations = async (req, res) => {
    try {
        const conversationRecords = await conversation.find().populate('freelancer').populate('client', conversationClientProjection);
        const allConversations = conversationRecords.map(toConversationResponse);
        if(allConversations.length !== 0) {
            res.status(200).json({ allConversations });
        }
        else {
            res.status(400).json({ msg:"No conversations found!" })
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({ msg:"Somthing went wrong!" });
    }
}

// Get a Conversation by ID
export const getConversationById = async (req, res) => {
    try {
        const { id } = req.params;

        // if (!mongoose.Types.ObjectId.isValid(id)) {
        //     return res.status(404).json({ msg: "Invalid Id" });
        // }
    
        const conversationRecord = await conversation.findById(id).populate("freelancer").populate("client", conversationClientProjection);
        if (!conversationRecord) {
            return res.status(404).json({ msg: "Conversation Not Found" });
        }

        const conversationData = toConversationResponse(conversationRecord);

        conversationData.freelancer.image_url = "http://" + req.hostname + ":3000/uploads/" + conversationData.freelancer.image_url;
        if (conversationData.client) {
            conversationData.client.image_url = "http://" + req.hostname + ":3000/uploads/" + conversationData.client.image_url;
        }
        return res.status(200).json({conversationData});

    } catch (error) {
        console.log(error);
        res.status(404).json({ msg: "Server Error" });
    }
};

// Get A Conversation By User ID
export const getConversationsByUserId = async (req, res) => {
    try {
        const filter = { lastMessage: undefined };

        await conversation.deleteMany(filter);
        // res.status(200).json({ msg:"Conversation has been deleted successfuly." });

        // res.status(400).json({ msg:"Conversation deletion failed." });
        // let role = req.params.role;
        // let userId = req.params.id;

        const userId = req.params.id;

        let freelancer = userId;

        let conversationData = await conversation.find({ freelancer }).populate('freelancer').populate('client', conversationClientProjection).populate("lastMessage");
        // console.log(conversationData);

        if(!conversationData[0]) {
            let client = userId;
            conversationData = await conversation.find({ client }).populate('freelancer').populate('client', conversationClientProjection).populate("lastMessage");
        }

        if(conversationData[0]) {

            const modifiedConversations = conversationData.map((conversation) => {
                const modifiedConversation = toConversationResponse(conversation);
                modifiedConversation.freelancer = { ...toPlainRecord(modifiedConversation.freelancer) }; // Create a copy of the freelancerId object
                modifiedConversation.freelancer.image_url = "http://" + req.hostname + ":3000/uploads/" + modifiedConversation.freelancer.image_url;
                if (modifiedConversation.client) {
                    modifiedConversation.client.image_url = "http://" + req.hostname + ":3000/uploads/" + modifiedConversation.client.image_url;
                }
                return modifiedConversation;
            });

            const result = modifiedConversations;
            return res.status(200).json({ result });
        }

        res.status(400).json({ msg:"conversation not found!" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ msg:"Somthing went wrong!" });
    }
}

// Add Conversation
export const addConversation = async (req, res) => {
    try {
        const freelancer = req.body.freelancer;
        const client = req.body.client;

        // Check if Freelancer is Exists in Freelancers

        // Check if Client is Exists in Clients

        const conversationData = await conversation.findOne({freelancer});

        // console.log(data);

        if(conversationData) {
            if(conversationData.client == client) {
                return res.status(400).json({ msg:"Conversation is already exists!", conversationData});
            }
        }

        const newConversation = new conversation({
            ...req.body,
        });

        await newConversation.save();

        const newConversationRecords = await conversation.find(newConversation._id).populate('freelancer', {_id: 1, name: 1, email: 1}).populate('client', conversationClientProjection);
        const newConversationData = newConversationRecords.map(toConversationResponse);

        res.status(200).json({ msg:"Conversation has been created successfuly.", newConversationData});
    } catch (error) {
        console.log(error);
        res.status(500).json({ msg:"Somthing went wrong!" });
    }
}

// Update Conversation
export const updateConversation = async (req, res) => {
    try {
        const conversationId = req.params.id;
        const conversationToUpdate = await conversation.findById(conversationId);

        if(conversationToUpdate) {
            const filter = { _id: conversationId };
            const update = { $set: { conversationName: req.body.conversationName, conversationCategory: req.body.conversationCategory, conversationPosts: req.body.conversationPosts, clientMemberIds: req.body.clientMemberIds, freelancerMemberIds: req.body.freelancerMemberIds, membersCount: req.body.membersCount } };
            await conversation.updateOne(filter, update);
            return res.status(200).json({ msg:"Conversation has been updated successfuly." });
        }

        res.status(400).json({ msg:"There is no conversation with such id to update." });
    } catch (error) {
        console.log(error);
        res.status(500).json({ msg:"Somthing went wrong!" });
    }
}

// Delete Conversation
export const deleteConversation = async (req, res) => {
    try {
        const conversationId = req.params.id
        const conversationToDelete = await conversation.findById(conversationId);

        if(conversationToDelete){
            const filter = { _id: conversationId };

            await conversation.deleteOne(filter);
            res.status(200).json({ msg:"Conversation has been deleted successfuly." });
        }
        else {
            res.status(400).json({ msg:"Conversation deletion failed." });
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({ msg:"Somthing went wrong!" });
    }
}
