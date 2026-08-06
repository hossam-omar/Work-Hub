
import Review from '../../../DB/models/review_model.js';
import service_model from '../../../DB/models/service_model.js';

const reviewClientProjection = Object.freeze({
    _id: 1,
    name: 1,
    image_url: 1,
    coverImage_url: 1,
    country: 1,
});

const toPlainRecord = (record) => record?._doc ?? record;

const toReviewClient = (clientRecord) => {
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

const toReviewResponse = (reviewRecord) => {
    const review = toPlainRecord(reviewRecord);

    return {
        ...review,
        clientId: toReviewClient(review.clientId),
    };
};

// Create a new review
export const createReview = async (req, res) => {
    try {
        const { clientId, rating, reviewDesc, serviceId } = req.body;

        const reviewData = await Review.findOne({ clientId, serviceId });
  
        if(reviewData) {
          return res.status(400).json({ message: "You have already reviewed this service!" });
        }

        const newReview = new Review({
          clientId,
          rating,
          reviewDesc,
          serviceId
        });
    
        await newReview.save();

        const serviceData = await service_model.findById(serviceId);

        if(!serviceData) {
            return res.status(404).json({ message: "Service not found!" });
        }

        var actualReviewsData = serviceData.reviews;

        var newReviewsData =  actualReviewsData.push(newReview._id);

        const filter = { _id: serviceId };
        const update = { $set: { reviews: newReviewsData } };
        await service_model.updateOne(filter, update);
    
        res.status(201).json({ success:true, message: 'Review created successfully', newReview });
    } catch (error) {
        res.status(500).json({msg:'Internal server error'});
        console.log(error);
    }
};

// Get all reviews
export const getServiceReviews = async (req, res) => {
    try {
        const serviceId = req.params.id;
        var reviews = await Review.find({ serviceId }).populate("clientId", reviewClientProjection).populate("serviceId");

        if(reviews.length == 0) {
            return res.status(404).json({ msg:"No reviews found!" });
        }

        const modifiedReviews = reviews.map((review) => {
            const modifiedReview = toReviewResponse(review);
            modifiedReview.clientId.image_url = "http://" + req.hostname + ":3000/uploads/" + modifiedReview.clientId.image_url;
            return modifiedReview;
        });

        reviews = modifiedReviews

        res.status(200).json({success:true, message:"here u r", reviews});
    } catch (error) {
        res.status(500).json({msg:'Internal server error'});
        console.log(error);
    }
};

// Get review by ID
export const getReviewById = async (req, res) => {
    try {
        const review = await Review.findById(req.params.id);

        if (!review) {
          return next(new Error("review not found",{cause:404}));
        }

        res.status(200).json({success:true, message:"here u r", review});
    } catch (error) {
        res.status(500).json({msg:'Internal server error'});
        console.log(error);
    }
};

// Delete a review
export const deleteReview = async (req, res) => {
  
    const review = await Review.findByIdAndDelete(req.params.id);
    if (!review) {
        return next(new Error("review not found",{cause:404}));
    }
    res.status(200).json({success:true, message:"review deleted successfully", review});
 
};
