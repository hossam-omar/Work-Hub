
import client_model from "../../../DB/models/client_model.js";
import order_model from "../../../DB/models/order_model.js";
import request_model from "../../../DB/models/request_model.js";
import service_model from "../../../DB/models/service_model.js";

const requestClientProjection = Object.freeze({
    _id: 1,
    name: 1,
    image_url: 1,
    coverImage_url: 1,
    country: 1,
});

const toPlainRecord = (record) => record?._doc ?? record;

const toRequestClient = (clientRecord) => {
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

const toRequestResponse = (requestRecord) => {
    const request = toPlainRecord(requestRecord);

    return {
        ...request,
        clientId: toRequestClient(request.clientId),
    };
};


// Get All Requests
export const getAllRequests = async (req, res) => {
    try {
        var allRequests = await request_model.find().populate("clientId", requestClientProjection).populate("serviceId");

        if(allRequests.length == 0) {
            return res.status(404).json({ msg:"No requests found!" });
        }

        const requests = allRequests.map((request) => {
            const modifiedRequest = toRequestResponse(request);
            modifiedRequest.serviceId = { ...toPlainRecord(modifiedRequest.serviceId) }; // Create a copy of the freelancerId object
            modifiedRequest.serviceId.serviceCover_url = "http://" + req.hostname + ":3000/uploads/" + modifiedRequest.serviceId.serviceCover_url;
            return modifiedRequest;
        });

        res.status(200).json(requests);
    } catch (error) {
        console.log(error);
        res.status(500).json({ msg:"Somthing went wrong!" });
    }
}

// Get Client Requests
export const getClientRequests = async (req, res) => {
    try {
        const clientId = req.params.id
        var allRequests = await request_model.find({clientId: clientId}).populate("clientId", requestClientProjection).populate("serviceId");

        if(allRequests.length == 0) {
            return res.status(404).json({ msg:"No requests found!" });
        }

        const requests = allRequests.map((request) => {
            const modifiedRequest = toRequestResponse(request);
            modifiedRequest.serviceId = { ...toPlainRecord(modifiedRequest.serviceId) }; // Create a copy of the freelancerId object
            modifiedRequest.serviceId.serviceCover_url = "http://" + req.hostname + ":3000/uploads/" + modifiedRequest.serviceId.serviceCover_url;
            return modifiedRequest;
        });

        res.status(200).json(requests);
    } catch (error) {
        console.log(error);
        res.status(500).json({ msg:"Somthing went wrong!" });
    }
}

// Get Freelancer Requests
export const getFreelancerRequests = async (req, res) => {
    try {
        const freelancerId = req.params.id;
        var allRequests = await request_model.find({freelancerId: freelancerId}).populate("clientId", requestClientProjection).populate("serviceId");

        if(allRequests.length == 0) {
            return res.status(404).json({ msg:"No requests found!" });
        }

        const requests = allRequests.map((request) => {
            const modifiedRequest = toRequestResponse(request);
            modifiedRequest.serviceId = { ...toPlainRecord(modifiedRequest.serviceId) }; // Create a copy of the freelancerId object
            modifiedRequest.serviceId.serviceCover_url = "http://" + req.hostname + ":3000/uploads/" + modifiedRequest.serviceId.serviceCover_url;
            return modifiedRequest;
        });

        res.status(200).json(requests);
    } catch (error) {
        console.log(error);
        res.status(500).json({ msg:"Somthing went wrong!" });
    }
}

export const getUserRequests = async (req, res) => {
    try {
        const userId = req.params.id;
        const role = req.params.role
        var allRequests

        if(role == "freelancer") {
            var allRequests = await request_model.find({freelancerId: userId}).populate("clientId", requestClientProjection).populate("serviceId");
        }
        else if(role == "client") {
            var allRequests = await request_model.find({clientId: userId}).populate("freelancerId").populate("serviceId");
        }
        else {
            return res.status(401).json({ msg:"Unauthorized!" });
        }

        if(allRequests.length == 0) {
            return res.status(404).json({ msg:"No requests found!" });
        }

        const requests = allRequests.map((request) => {
            const modifiedRequest = role == "freelancer"
                ? toRequestResponse(request)
                : { ...toPlainRecord(request) };
            modifiedRequest.serviceId = { ...toPlainRecord(modifiedRequest.serviceId) }; // Create a copy of the freelancerId object
            modifiedRequest.serviceId.serviceCover_url = "http://" + req.hostname + ":3000/uploads/" + modifiedRequest.serviceId.serviceCover_url;
            return modifiedRequest;
        });

        res.status(200).json(requests);
    } catch (error) {
        console.log(error);
        res.status(500).json({ msg:"Somthing went wrong!" });
    }
}

// Add Request
export const addRequest = async (req, res) => {
    try {
        const filter = {
            $and: [
                { clientId: req.body.clientId },
                { freelancerId: req.body.freelancerId },
                { serviceId: req.body.serviceId },
                { requestStatus : "Pending"}
            ]
        };

        const data = await request_model.find(filter);

        if(data[0]) {
            if(data[0].requestStatus == "Pending") {
                return res.status(400).json({ msg:"Request has already been sent." });
            }
        }

        const newRequest = new request_model({
            ...req.body,
        });

        await newRequest.save();
        res.status(200).json({ msg:"Request has been created successfuly." });
    } catch (error) {
        console.log(error);
        res.status(500).json({ msg:"Somthing went wrong!" });
    }
}

// Update Request Status
export const updateRequestStatus = async (req, res) => {
    try {
        const requestId = req.params.id;
        const requestToUpdate = await request_model.findById(requestId);

        if(requestToUpdate) {

            if(requestToUpdate.requestStatus == "Approved" || requestToUpdate.requestStatus == "Decline") {
                return res.status(404).json({ msg:"Request Already " + requestToUpdate.requestStatus });
            }

            let filter = { _id: requestId };
            let update = { $set: { requestStatus: req.body.requestStatus} };
            let process = await request_model.updateOne(filter, update);

            if(process) {
                if(req.body.requestStatus === "Approved") {
                    const freelancerId = req.body.freelancerId;
                    const clientId = requestToUpdate.clientId;
                    const serviceId = requestToUpdate.serviceId;

                    // const serviceData = await request.findById(serviceId);

                    const newOrder = new order_model({
                        requestId,
                        freelancerId,
                        clientId,
                        serviceId
                    });
            
                    await newOrder.save();
                    // res.status(200).send("Order has been created successfuly.");

                    const serviceToUpdate = await service_model.findById(serviceId);

                    const orders = serviceToUpdate.orders;

                    orders.push(newOrder._id);

                    filter = { _id: serviceId };
                    update = { $set: { orders: orders} };
                    process = await service_model.updateOne(filter, update);

                    const clientToUpdate = await client_model.findById(clientId);

                    filter = { _id: clientId };
                    update = { $set: { ordersCount: clientToUpdate.ordersCount + 1} };
                    process = await client_model.updateOne(filter, update);

                    return res.status(200).json({ msg:"Request Approved Successfuly." });
                }
                else {
                    return res.status(200).json({ msg:"Request Declined successfuly." });
                }
            }
            return res.status(400).json({ msg:"Request status update failed" });
        }
        res.status(404).json({ msg:"Request not found!" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ msg:"Somthing went wrong!" });
    }
}

// Delete Request
export const deleteRequest = async (req, res) => {
    try {
        const requestId = req.params.id
        const requestToDelete = await request_model.findById(requestId);

        if(requestToDelete){
            const filter = { _id: requestId };

            await request_model.deleteOne(filter);
            return res.status(200).json({ msg:"Request has been Canceled." });
        }
        else {
            res.status(200).json({ msg:"There is no request with such id to delete." });
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({ msg:"Somthing went wrong!" });
    }
}
